/**
 * Harness UI. Deliberately plain — this page exists to prove the plumbing,
 * and it is unlinked from the site nav until there is something worth linking.
 */
import {
  createBackend, listProviders, detectWebGpu, estimateStorage, downloadCaution,
  LOCAL_MODELS, DEFAULT_LOCAL_MODEL, ERR, isAbort,
} from "./llm/index.js";

const KEY_STORAGE = "typology.hosted.key";
const $ = (id) => document.getElementById(id);

/**
 * A throwaway item. Not a typology question, on purpose: Phase 1's job is the
 * plumbing, and real items would let domain decisions leak into the interface.
 */
const DEMO_ITEM = {
  id: "demo-indentation",
  prompt: "You open an unfamiliar file whose indentation disagrees with your editor's default. What do you do?",
  poles: [
    { id: "match", label: "Match the file", hint: "leave the existing style alone" },
    { id: "impose", label: "Use your own style", hint: "reformat toward your default" },
  ],
};

let backend = null;
let loadAbort = null;
let runAbort = null;

/* ---------- capability ---------- */

async function renderCapability() {
  const [gpu, storage] = await Promise.all([detectWebGpu(), estimateStorage()]);
  const caution = downloadCaution();
  const bits = [];

  bits.push(gpu.supported
    ? `<span class="ok">WebGPU available</span> — ${gpu.vendor}${gpu.architecture ? ` / ${gpu.architecture}` : ""}`
    : `<span class="warn">No WebGPU</span> — ${gpu.reason}`);

  if (storage) bits.push(`Storage: ~${storage.freeMB.toLocaleString()} MB free of ${storage.quotaMB.toLocaleString()} MB`);
  if (caution.saveData) bits.push(`<span class="warn">Data Saver is on</span>`);
  if (caution.slowNetwork) bits.push(`<span class="warn">Connection reports as slow</span>`);

  $("capability").innerHTML = bits.map((b) => `<div>${b}</div>`).join("");

  if (!gpu.supported) {
    // The degradation path: local is not merely discouraged, it is unavailable,
    // so move the user to the backend that can actually work here.
    const localRadio = document.querySelector('input[value="local"]');
    localRadio.disabled = true;
    localRadio.closest("label").classList.add("bad");
    document.querySelector('input[value="hosted"]').checked = true;
    syncBackendChoice();
  }
}

/* ---------- pickers ---------- */

function syncBackendChoice() {
  const kind = document.querySelector('input[name="backend"]:checked').value;
  $("local-opts").hidden = kind !== "local";
  $("hosted-opts").hidden = kind !== "hosted";
  teardown();
}

function renderModels() {
  $("model").innerHTML = LOCAL_MODELS
    .map((m) => `<option value="${m.id}"${m.id === DEFAULT_LOCAL_MODEL ? " selected" : ""}>${m.label} — ${m.megabytes.toLocaleString()} MB</option>`)
    .join("");
  syncSizeNote();
}

function syncSizeNote() {
  const model = LOCAL_MODELS.find((m) => m.id === $("model").value);
  if (!model) return;
  const caution = downloadCaution();
  const warn = caution.smallScreen || caution.slowNetwork || caution.saveData;
  $("size-note").innerHTML = `One-time ${model.megabytes.toLocaleString()} MB download from HuggingFace's CDN, then cached in this browser. Nothing is sent to this site.`
    + (warn ? ` <span class="warn">On this connection or screen you may not want to.</span>` : "");
}

async function renderProviders() {
  const providers = await listProviders();
  $("provider").innerHTML = Object.entries(providers)
    .map(([id, p]) => `<option value="${id}">${p.label} — ${p.defaultModel}</option>`).join("");
  syncKeyNote(providers);
  $("provider").addEventListener("change", () => syncKeyNote(providers));
}

function syncKeyNote(providers) {
  const spec = providers[$("provider").value];
  $("key-note").textContent = `${spec.keyHint}. Your key stays in this browser and goes only to ${spec.label} — never to this site.`;
}

/* ---------- lifecycle ---------- */

function teardown() {
  backend?.dispose?.();
  backend = null;
  $("run").disabled = true;
  $("progress").hidden = true;
  $("bar-fill").style.width = "0";
}

function setError(message, cls = "bad") {
  $("result").innerHTML = `<p class="${cls}">${message}</p>`;
}

async function loadBackend() {
  teardown();
  loadAbort = new AbortController();
  $("load").disabled = true;
  $("cancel-load").hidden = false;
  $("progress").hidden = false;
  $("progress-text").textContent = "starting…";
  setError("—", "note");

  const kind = document.querySelector('input[name="backend"]:checked').value;
  try {
    backend = kind === "local"
      ? await createBackend("local", { modelId: $("model").value })
      : await createBackend("hosted", { provider: $("provider").value, getKey: () => $("key").value.trim() });

    await backend.init({
      signal: loadAbort.signal,
      onProgress: ({ progress, text }) => {
        $("bar-fill").style.width = `${Math.round((progress ?? 0) * 100)}%`;
        $("progress-text").textContent = text ?? "";
      },
    });

    $("bar-fill").style.width = "100%";
    $("progress-text").innerHTML = `<span class="ok">${backend.label} ready.</span>`;
    $("run").disabled = false;
  } catch (err) {
    backend = null;
    $("progress-text").innerHTML = isAbort(err)
      ? `<span class="warn">Cancelled.</span>`
      : `<span class="bad">${err.message}</span>`;
    if (err.code === ERR.NO_WEBGPU) {
      $("progress-text").innerHTML += ` <span class="note">Switch to a hosted key above.</span>`;
    }
  } finally {
    $("load").disabled = false;
    $("cancel-load").hidden = true;
    loadAbort = null;
  }
}

async function run() {
  let item;
  try {
    item = JSON.parse($("item").value);
    if (!Array.isArray(item.poles) || item.poles.length < 2) throw new Error("needs at least two poles");
  } catch (err) {
    setError(`Item JSON is not usable: ${err.message}`);
    return;
  }

  runAbort = new AbortController();
  $("run").disabled = true;
  $("cancel-run").hidden = false;
  $("stream").textContent = "";
  $("result").innerHTML = `<p class="note">thinking…</p>`;

  const started = performance.now();
  try {
    const out = await backend.classify(item, $("answer").value, {
      signal: runAbort.signal,
      onToken: (t) => {
        $("stream").textContent += t;
        $("stream").scrollTop = $("stream").scrollHeight;
      },
    });
    renderResult(out, performance.now() - started, item);
  } catch (err) {
    setError(isAbort(err) ? "Cancelled." : `${err.code ?? "ERROR"}: ${err.message}`,
             isAbort(err) ? "warn" : "bad");
  } finally {
    $("run").disabled = false;
    $("cancel-run").hidden = true;
    runAbort = null;
  }
}

function renderResult(out, ms, item) {
  const pole = item.poles.find((p) => p.id === out.pole);
  const repairs = out.repairs.length
    ? out.repairs.map((r) => `<span class="tag">${r}</span>`).join("")
    : `<span class="ok">none — clean first pass</span>`;
  $("result").innerHTML = `
    <dl>
      <dt>Pole</dt><dd><strong>${out.pole}</strong> — ${pole?.label ?? "?"}</dd>
      <dt>Confidence</dt><dd>${out.confidence.toFixed(2)}</dd>
      <dt>Rationale</dt><dd>${out.rationale || "<span class='note'>(none given)</span>"}</dd>
      <dt>Repairs</dt><dd>${repairs}</dd>
      <dt>Backend</dt><dd>${out.backend} · <code>${out.model}</code> · ${Math.round(ms)} ms</dd>
    </dl>`;
}

/* ---------- wiring ---------- */

$("item").value = JSON.stringify(DEMO_ITEM, null, 2);
$("key").value = localStorage.getItem(KEY_STORAGE) ?? "";
$("key").addEventListener("change", () => {
  // Held here so a reload does not cost the visitor another paste. It is their
  // key, on their machine, and it is never transmitted to this origin.
  try { localStorage.setItem(KEY_STORAGE, $("key").value.trim()); } catch { /* private mode */ }
});
$("model").addEventListener("change", () => { syncSizeNote(); teardown(); });
document.querySelectorAll('input[name="backend"]').forEach((el) =>
  el.addEventListener("change", syncBackendChoice));
$("load").addEventListener("click", loadBackend);
$("cancel-load").addEventListener("click", () => loadAbort?.abort());
$("run").addEventListener("click", run);
$("cancel-run").addEventListener("click", () => runAbort?.abort());

renderModels();
renderProviders();
renderCapability();
