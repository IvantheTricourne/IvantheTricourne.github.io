/**
 * Phase 3 runner: twelve items through `classify()`, then deterministic
 * scoring, then unstyled JSON.
 *
 * The LLM's only job here is mapping a free-text answer onto one of an item's
 * named poles. Everything downstream — weights, stack derivation, tritype — is
 * pure arithmetic in scoring.js, and is not the model's business. That split is
 * deliberate: Phase 2 established the model is reliable at constrained
 * classification and says nothing about it being reliable at anything else.
 */
import {
  createBackend, listProviders, detectWebGpu,
  LOCAL_MODELS, DEFAULT_LOCAL_MODEL, isAbort,
} from "./llm/index.js";
import { BASE_ITEMS, GATED_ITEMS, shouldAsk, applyAnswer } from "./llm/items.js";
import { scoreAll } from "./llm/scoring.js";

const KEY_STORAGE = "typology.hosted.key";
const $ = (id) => document.getElementById(id);

let backend = null;
let queue = [];
let index = 0;
let tables = {};
let answered = 0;
let abstained = 0;
let transcript = [];
let busy = false;

/* ---------- setup ---------- */

async function boot() {
  $("model").innerHTML = LOCAL_MODELS
    .map((m) => `<option value="${m.id}"${m.id === DEFAULT_LOCAL_MODEL ? " selected" : ""}>${m.label}</option>`)
    .join("");

  const providers = await listProviders();
  $("provider").innerHTML = Object.entries(providers)
    .map(([id, p]) => `<option value="${id}">${p.label}</option>`).join("");
  const syncProvider = () => { $("hosted-model").value = providers[$("provider").value].defaultModel; };
  $("provider").addEventListener("change", syncProvider);
  syncProvider();

  $("key").value = localStorage.getItem(KEY_STORAGE) ?? "";
  $("key").addEventListener("change", () => {
    try { localStorage.setItem(KEY_STORAGE, $("key").value.trim()); } catch { /* private mode */ }
  });

  const gpu = await detectWebGpu();
  if (!gpu.supported) {
    const local = document.querySelector('input[value="local"]');
    local.disabled = true;
    local.closest("label").classList.add("bad");
    document.querySelector('input[value="hosted"]').checked = true;
    syncBackendChoice();
  }
}

function syncBackendChoice() {
  const kind = document.querySelector('input[name="backend"]:checked').value;
  $("local-opts").hidden = kind !== "local";
  $("hosted-opts").hidden = kind !== "hosted";
}

/* ---------- run ---------- */

async function start() {
  $("start").disabled = true;
  $("progress").hidden = false;
  $("progress-text").textContent = "loading…";

  const kind = document.querySelector('input[name="backend"]:checked').value;
  try {
    backend?.dispose?.();
    backend = kind === "local"
      ? await createBackend("local", { modelId: $("model").value })
      : await createBackend("hosted", {
          provider: $("provider").value,
          model: $("hosted-model").value.trim(),
          getKey: () => $("key").value.trim(),
        });
    await backend.init({
      onProgress: ({ progress, text }) => {
        $("bar-fill").style.width = `${Math.round((progress ?? 0) * 100)}%`;
        $("progress-text").textContent = text ?? "";
      },
    });
  } catch (err) {
    $("progress-text").innerHTML = `<span class="bad">${err.message}</span>`;
    $("start").disabled = false;
    return;
  }

  $("progress-text").innerHTML = `<span class="ok">${backend.label} ready.</span>`;
  queue = [...BASE_ITEMS];
  index = 0; tables = {}; answered = 0; abstained = 0; transcript = [];
  $("quiz-section").hidden = false;
  $("result-section").hidden = true;
  render();
}

function render() {
  const item = queue[index];
  if (!item) return finish();
  $("counter").textContent = `${index + 1} of ${queue.length} — ${item.axis}`;
  $("prompt").textContent = item.prompt;
  $("poles").innerHTML = item.poles
    .map((p) => `<li><span><strong>${p.label}</strong>${p.hint ? ` <span class="note">— ${p.hint}</span>` : ""}</span></li>`)
    .join("");
  $("answer").value = "";
  $("answer").focus();
}

async function submit({ skipped = false } = {}) {
  if (busy) return;
  const item = queue[index];
  if (!item) return;

  if (skipped) {
    abstained += 1;
    transcript.push({ item: item.id, answer: null, pole: null, skipped: true });
    return advance();
  }

  busy = true;
  $("submit").disabled = true;
  $("last").textContent = "reading that…";
  try {
    const out = await backend.classify(item, $("answer").value);
    if (out.abstained) {
      // The model declined. Phase 2 measured this as usually correct on a real
      // non-answer, so it is recorded and scored as nothing rather than forced.
      abstained += 1;
      $("last").innerHTML = `<span class="warn">Could not read an answer out of that</span> — counted as a skip.`;
    } else {
      applyAnswer(tables, item, out.pole);
      answered += 1;
      const pole = item.poles.find((p) => p.id === out.pole);
      $("last").innerHTML = `<span class="ok">${pole?.label ?? out.pole}</span>`
        + ` <span class="note">(${out.confidence.toFixed(2)}) — ${out.rationale}</span>`;
    }
    transcript.push({
      item: item.id, answer: $("answer").value, pole: out.pole,
      abstained: out.abstained, confidence: out.confidence,
      rationale: out.rationale, repairs: out.repairs,
    });
    advance();
  } catch (err) {
    $("last").innerHTML = isAbort(err)
      ? `<span class="warn">Cancelled.</span>`
      : `<span class="bad">${err.code ?? "ERROR"}: ${err.message}</span> <span class="note">Try rewording, or skip.</span>`;
  } finally {
    busy = false;
    $("submit").disabled = false;
  }
}

function advance() {
  index += 1;
  // Gates are evaluated once the ungated items are done, so a tie-break item
  // is asked against complete evidence rather than a partial table.
  if (index === queue.length && queue.length === BASE_ITEMS.length) {
    queue = [...queue, ...GATED_ITEMS.filter((i) => shouldAsk(i, tables))];
  }
  render();
}

function finish() {
  $("quiz-section").hidden = true;
  $("result-section").hidden = false;
  const result = scoreAll({
    functions: tables.functions ?? {},
    enneagram: tables.enneagram ?? {},
    answered, abstained,
  });
  $("result").textContent = JSON.stringify({
    ...result,
    backend: { id: backend?.id, model: backend?.model },
    transcript,
  }, null, 2);
}

/* ---------- wiring ---------- */

document.querySelectorAll('input[name="backend"]').forEach((el) =>
  el.addEventListener("change", syncBackendChoice));
$("start").addEventListener("click", start);
$("submit").addEventListener("click", () => submit());
$("skip").addEventListener("click", () => submit({ skipped: true }));
$("restart").addEventListener("click", () => {
  queue = [...BASE_ITEMS];
  index = 0; tables = {}; answered = 0; abstained = 0; transcript = [];
  $("result-section").hidden = true;
  $("quiz-section").hidden = false;
  render();
});
$("answer").addEventListener("keydown", (e) => {
  // Enter submits; the answers are a sentence, not a paragraph.
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
});

boot();
