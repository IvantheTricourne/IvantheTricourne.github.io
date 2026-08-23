/**
 * Harness UI. Deliberately plain — this page exists to prove the plumbing,
 * and it is unlinked from the site nav until there is something worth linking.
 */
import {
  createBackend, listProviders, detectWebGpu, estimateStorage, downloadCaution,
  LOCAL_MODELS, DEFAULT_LOCAL_MODEL, sizeOf, formatSize, isReliable, ERR, isAbort, ABSTAIN,
} from "./llm/index.js";
import { inspectAll, deleteModel } from "./llm/cache.js";

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
/** Storage estimate. Refreshed on demand — a stale copy silently misreports. */
let storage = null;
/** Per-model Cache API state, keyed by model id. */
let cacheState = {};
/** Set once the user has knowingly accepted a download larger than free space. */
let storageOverridden = false;

/* ---------- storage & cache ---------- */

/**
 * Phase 1 read the quota once at page load and never again, so clearing a
 * cached model left the gate insisting on the old figure until a full reload —
 * with nothing on screen to suggest a reload was needed. Anything that can
 * change what is on disk calls this.
 */
async function refreshStorage() {
  storage = await estimateStorage();
  cacheState = await inspectAll(LOCAL_MODELS);
  return storage;
}

function modelSize(model) {
  return sizeOf(model, cacheState[model?.id]);
}

/* ---------- capability ---------- */

async function renderCapability() {
  const [gpu] = await Promise.all([detectWebGpu(), refreshStorage()]);
  const caution = downloadCaution();
  const bits = [];

  bits.push(gpu.supported
    ? `<span class="ok">WebGPU available</span> — ${gpu.vendor}${gpu.architecture ? ` / ${gpu.architecture}` : ""}`
    : `<span class="warn">No WebGPU</span> — ${gpu.reason}`);

  if (storage) bits.push(`Storage: ~${storage.freeMB.toLocaleString()} MB free of ${storage.quotaMB.toLocaleString()} MB`);
  if (caution.saveData) bits.push(`<span class="warn">Data Saver is on</span>`);
  if (caution.slowNetwork) bits.push(`<span class="warn">Connection reports as slow</span>`);

  $("capability").innerHTML = bits.map((b) => `<div>${b}</div>`).join("");
  renderModels();

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
  syncLoadButton();
  teardown();
}

function renderModels() {
  const selected = $("model").value || DEFAULT_LOCAL_MODEL;
  $("model").innerHTML = LOCAL_MODELS
    .map((m) => {
      const mark = cacheState[m.id]?.cached ? " · on disk" : "";
      return `<option value="${m.id}"${m.id === selected ? " selected" : ""}>`
        + `${m.label} — ${formatSize(modelSize(m))}${mark}</option>`;
    })
    .join("");
  syncSizeNote();
  syncCachePanel();
  syncLoadButton();
}

/**
 * Cached models get a way out that is not DevTools.
 *
 * Phase 1 offered a multi-gigabyte download and no corresponding delete, which
 * left "pick a smaller model" as advice a visitor could not act on once the
 * larger one was already resident and occupying the quota.
 */
function syncCachePanel() {
  const resident = LOCAL_MODELS.filter((m) => cacheState[m.id]?.cached);
  if (!resident.length) {
    $("cache-panel").innerHTML = `<span class="note">No models on disk yet.</span>`;
    return;
  }
  const total = resident.reduce((sum, m) => sum + (cacheState[m.id].megabytes || 0), 0);
  $("cache-panel").innerHTML = `
    <p class="note">On disk — ${total.toLocaleString()} MB total. Deleting frees quota immediately.</p>
    <ul class="cache-list">${resident.map((m) => {
      const c = cacheState[m.id];
      return `<li><span>${m.label} — ${formatSize(sizeOf(m, c))} <span class="note">(${c.entries} files)</span></span>`
        + `<button type="button" class="link" data-delete="${m.id}">Delete</button></li>`;
    }).join("")}</ul>`;
}

async function onDelete(modelId) {
  const model = LOCAL_MODELS.find((m) => m.id === modelId);
  const button = document.querySelector(`[data-delete="${modelId}"]`);
  if (button) { button.disabled = true; button.textContent = "deleting…"; }
  if (backend?.model === modelId) teardown();
  try {
    const { freedMB } = await deleteModel(modelId);
    await refreshStorage();
    renderModels();
    $("cache-panel").insertAdjacentHTML("beforeend",
      `<p class="ok">Freed ~${freedMB.toLocaleString()} MB from ${model?.label ?? modelId}.</p>`);
  } catch (err) {
    $("cache-panel").insertAdjacentHTML("beforeend",
      `<p class="bad">Could not delete: ${err.message}</p>`);
  }
}

/**
 * The button says what it will cost. A multi-gigabyte download must never be
 * describable as "Load backend" — the price belongs at the moment of the
 * click, not only in a note above it.
 */
function syncLoadButton() {
  const kind = document.querySelector('input[name="backend"]:checked').value;
  if (kind !== "local") {
    $("load").textContent = "Connect";
    return;
  }
  const model = LOCAL_MODELS.find((m) => m.id === $("model").value);
  if (!model) { $("load").textContent = "Load model"; return; }
  // Already resident: there is nothing to download and saying otherwise would
  // overstate the cost of a click that is now nearly free.
  $("load").textContent = cacheState[model.id]?.cached
    ? `Load ${model.label} from disk`
    : `Download ${formatSize(modelSize(model))} & load`;
}

/**
 * Weights land in the Cache API, which is origin-scoped and evictable — not
 * localStorage, which caps out around 5 MB and could never hold a model.
 *
 * The quota is the part worth checking: a browser can report far less free
 * space than the model needs, and without this the download simply dies
 * partway through with nothing useful to show for it.
 */
function storageVerdict(model) {
  if (!storage || !model) return { known: false, fits: true };
  if (cacheState[model.id]?.cached) return { known: true, fits: true, cached: true };
  const size = modelSize(model);
  return {
    known: true,
    fits: storage.freeMB >= size.megabytes,
    freeMB: storage.freeMB,
    size,
    /**
     * Whether the shortfall is worth blocking a click over.
     *
     * True for a real measurement or a verified catalogue size, false for the
     * VRAM fallback. That fallback once refused a 979 MB download against
     * 1,438 MB free — the model it blocked was never too big — so it warns
     * rather than gates now that a delete button is one click away.
     */
    firm: isReliable(size),
  };
}

function syncSizeNote() {
  const model = LOCAL_MODELS.find((m) => m.id === $("model").value);
  if (!model) return;
  const caution = downloadCaution();
  const warn = caution.smallScreen || caution.slowNetwork || caution.saveData;
  const verdict = storageVerdict(model);
  const { megabytes, source } = modelSize(model);

  let note;
  if (verdict.cached) {
    const how = source === "measured"
      ? "measured"
      : "measured across the shards that report a size, so a floor";
    note = `Already on disk — ${formatSize({ megabytes, source })}, ${how}.`
      + ` Loading is a cache read, not a download.`;
  } else {
    note = `One-time ${formatSize({ megabytes, source })} download from HuggingFace's CDN, then cached in`
      + ` this browser (Cache API, not localStorage). Nothing is sent to this site.`;
    if (source === "estimated") {
      // Naming the estimate matters: it ran up to 2.08x actual disk on real
      // hardware, so a refusal here may be refusing a download that would fit.
      note += ` <span class="warn">No verified size for this model — that is WebLLM's GPU-memory figure, which has measured up to twice the actual disk.</span>`;
    }
  }
  if (verdict.known && !verdict.fits) {
    note += ` <span class="bad">Only ~${verdict.freeMB.toLocaleString()} MB free — this will not fit.</span>`;
  } else if (warn && !verdict.cached) {
    note += ` <span class="warn">On this connection or screen you may not want to.</span>`;
  }
  if (!verdict.cached) {
    note += ` <span class="note">The browser may evict it later; it is a cache, not permanent storage.</span>`;
  }
  $("size-note").innerHTML = note;
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
  // Prefilled, not hardcoded. Provider model ids get retired on a timescale
  // shorter than this page's redeploys — Groq shut one down mid-review — so
  // the field is the escape hatch when a default goes stale.
  $("hosted-model").value = spec.defaultModel;
  $("hosted-model").placeholder = spec.defaultModel;
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

  if (kind === "local") {
    // Re-read the quota rather than trusting the page-load figure: a delete in
    // this session, or an eviction outside it, both change the answer.
    await refreshStorage();
    const model = LOCAL_MODELS.find((m) => m.id === $("model").value);
    const verdict = storageVerdict(model);
    if (verdict.known && !verdict.fits && verdict.firm && !storageOverridden) {
      // Only a real measurement stops a click. See storageVerdict.
      storageOverridden = true;
      renderModels();
      $("progress-text").innerHTML =
        `<span class="bad">~${verdict.freeMB.toLocaleString()} MB free, ${formatSize(verdict.size)} needed.</span>`
        + ` <span class="note">Delete a cached model below, pick a smaller one, or press again to try anyway.</span>`;
      $("load").disabled = false;
      $("cancel-load").hidden = true;
      loadAbort = null;
      return;
    }
    if (verdict.known && !verdict.fits) {
      // Estimated shortfall: say so and start anyway. The number has measured
      // twice the real size, and a failed download is now one click to clear.
      $("progress-text").innerHTML =
        `<span class="warn">~${verdict.freeMB.toLocaleString()} MB free against an estimated ${formatSize(verdict.size)}.</span>`
        + ` <span class="note">The estimate runs high; starting anyway.</span>`;
    }
    // Without this a multi-gigabyte cache is a prime eviction candidate.
    try { await navigator.storage?.persist?.(); } catch { /* not offered here */ }
  }

  try {
    backend = kind === "local"
      ? await createBackend("local", { modelId: $("model").value })
      : await createBackend("hosted", {
          provider: $("provider").value,
          model: $("hosted-model").value.trim(),
          getKey: () => $("key").value.trim(),
        });

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
    if (kind === "local") {
      // First measurement of what the download actually cost on disk.
      await refreshStorage();
      renderModels();
    }
  } catch (err) {
    backend = null;
    $("progress-text").innerHTML = isAbort(err)
      ? `<span class="warn">Cancelled.</span>`
      : `<span class="bad">${err.message}</span>`;
    if (err.code === ERR.NO_WEBGPU) {
      $("progress-text").innerHTML += ` <span class="note">Switch to a hosted key above.</span>`;
    }
    if (err.code === ERR.OUT_OF_MEMORY) {
      // Distinct from a storage shortfall, and the advice is the opposite one.
      $("progress-text").innerHTML += ` <span class="note">Deleting cached models will not help here — this is GPU memory, not disk.</span>`;
    }
  } finally {
    $("load").disabled = false;
    $("cancel-load").hidden = true;
    syncLoadButton();
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

  const abstain = $("abstain").checked;
  runAbort = new AbortController();
  $("run").disabled = true;
  $("cancel-run").hidden = false;
  $("stream").textContent = "";
  $("result").innerHTML = `<p class="note">thinking…</p>`;

  const started = performance.now();
  try {
    const out = await backend.classify(item, $("answer").value, {
      abstain,
      signal: runAbort.signal,
      onToken: (t) => {
        $("stream").textContent += t;
        $("stream").scrollTop = $("stream").scrollHeight;
      },
    });
    renderResult(out, performance.now() - started, item, abstain);
  } catch (err) {
    setError(isAbort(err) ? "Cancelled." : `${err.code ?? "ERROR"}: ${err.message}`,
             isAbort(err) ? "warn" : "bad");
  } finally {
    $("run").disabled = false;
    $("cancel-run").hidden = true;
    runAbort = null;
  }
}

function renderResult(out, ms, item, abstain) {
  const pole = item.poles.find((p) => p.id === out.pole);
  const repairs = out.repairs.length
    ? out.repairs.map((r) => `<span class="tag">${r}</span>`).join("")
    : `<span class="ok">none — clean first pass</span>`;
  // An abstention is a real outcome, not a missing one, and must not be
  // rendered as a pole whose label happens to be blank.
  const poleCell = out.abstained
    ? `<strong class="warn">${ABSTAIN}</strong> — model declined to classify`
    : `<strong>${out.pole}</strong> — ${pole?.label ?? "?"}`;
  $("result").innerHTML = `
    <dl>
      <dt>Pole</dt><dd>${poleCell}</dd>
      <dt>Confidence</dt><dd>${out.confidence.toFixed(2)}</dd>
      <dt>Rationale</dt><dd>${out.rationale || "<span class='note'>(none given)</span>"}</dd>
      <dt>Repairs</dt><dd>${repairs}</dd>
      <dt>Contract</dt><dd>${abstain ? "abstention offered" : "phase 1 control — no abstention"}</dd>
      <dt>Backend</dt><dd>${out.backend} · <code>${out.model}</code> · ${Math.round(ms)} ms</dd>
    </dl>`;
}

/**
 * Show the question as a question.
 *
 * Phase 1 put the item in a raw JSON textarea and nothing else, so a scroll
 * position that hid line 2 hid the entire prompt — leaving pole definitions on
 * screen with no question attached. The first person to use it typed "what is
 * supposed to be in here?" into the answer box, which was a fair reading.
 */
function syncItemPrompt() {
  try {
    const item = JSON.parse($("item").value);
    const poles = (item.poles ?? []).map((p) => p.label ?? p.id).join(" · ");
    $("item-prompt").innerHTML = `${item.prompt ?? "(no prompt)"} <span class="note">${poles}</span>`;
  } catch {
    $("item-prompt").innerHTML = `<span class="bad">Item JSON is not parseable.</span>`;
  }
}

/* ---------- wiring ---------- */

$("item").value = JSON.stringify(DEMO_ITEM, null, 2);
$("item").addEventListener("input", syncItemPrompt);
syncItemPrompt();
$("key").value = localStorage.getItem(KEY_STORAGE) ?? "";
$("key").addEventListener("change", () => {
  // Held here so a reload does not cost the visitor another paste. It is their
  // key, on their machine, and it is never transmitted to this origin.
  try { localStorage.setItem(KEY_STORAGE, $("key").value.trim()); } catch { /* private mode */ }
});
$("model").addEventListener("change", async () => {
  storageOverridden = false;
  teardown();
  await refreshStorage();
  renderModels();
});
$("cache-panel").addEventListener("click", (e) => {
  const id = e.target?.dataset?.delete;
  if (id) onDelete(id);
});
document.querySelectorAll('input[name="backend"]').forEach((el) =>
  el.addEventListener("change", syncBackendChoice));
$("load").addEventListener("click", loadBackend);
$("cancel-load").addEventListener("click", () => loadAbort?.abort());
$("run").addEventListener("click", run);
$("cancel-run").addEventListener("click", () => runAbort?.abort());

renderModels();
renderProviders();
renderCapability();
