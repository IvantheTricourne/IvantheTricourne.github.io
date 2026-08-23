/**
 * Runner for the #25 measurement suite.
 *
 * Sequential on purpose. A local engine serves one request at a time anyway,
 * and firing hosted calls in parallel would trade a rate-limit error for every
 * measurement it was supposed to speed up.
 */
import {
  createBackend, listProviders, detectWebGpu,
  LOCAL_MODELS, DEFAULT_LOCAL_MODEL, isAbort,
} from "./llm/index.js";
import { BENCH_ITEM, CASES, scoreCase, summarize } from "./llm/bench.js";

const KEY_STORAGE = "typology.hosted.key";
const $ = (id) => document.getElementById(id);

let backend = null;
let abort = null;
let rows = [];

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
    $("backend-note").innerHTML = `<span class="warn">No WebGPU here</span> — ${gpu.reason} Hosted only.`;
  }
}

function syncBackendChoice() {
  const kind = document.querySelector('input[name="backend"]:checked').value;
  $("local-opts").hidden = kind !== "local";
  $("hosted-opts").hidden = kind !== "hosted";
}

/* ---------- run ---------- */

function armsToRun() {
  const choice = document.querySelector('input[name="arm"]:checked').value;
  if (choice === "both") return [true, false];
  return [choice === "abstain"];
}

async function start() {
  abort = new AbortController();
  rows = [];
  $("start").disabled = true;
  $("stop").hidden = false;
  $("progress").hidden = false;
  $("rows").innerHTML = "";
  $("summary").textContent = "loading…";

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
      signal: abort.signal,
      onProgress: ({ progress, text }) => {
        $("bar-fill").style.width = `${Math.round((progress ?? 0) * 100)}%`;
        $("progress-text").textContent = text ?? "";
      },
    });
  } catch (err) {
    $("progress-text").innerHTML = `<span class="bad">${err.message}</span>`;
    finish();
    return;
  }

  const arms = armsToRun();
  // One throwaway pass before anything is recorded. Compile and prefill cost
  // 4.8x the steady-state figure on Qwen3 1.7B; folding that into the first
  // case would misreport it as that case being slow.
  $("progress-text").textContent = "warming up…";
  try {
    await runOne(CASES[0], arms[0], true);
  } catch { /* a warmup failure is reported by the real run that follows */ }

  const total = arms.length * CASES.length;
  let done = 0;
  for (const abstain of arms) {
    for (const testCase of CASES) {
      if (abort.signal.aborted) break;
      const row = await runOne(testCase, abstain, false);
      rows.push(row);
      appendRow(row);
      done += 1;
      $("bar-fill").style.width = `${Math.round((done / total) * 100)}%`;
      $("progress-text").textContent = `${done} / ${total} — ${testCase.id}`;
      render();
    }
  }
  $("progress-text").innerHTML = abort.signal.aborted
    ? `<span class="warn">Stopped after ${rows.length} runs.</span>`
    : `<span class="ok">Done — ${rows.length} runs.</span>`;
  finish();
}

async function runOne(testCase, abstain, warmup) {
  const started = performance.now();
  const base = {
    caseId: testCase.id, category: testCase.category,
    arm: abstain ? "abstain" : "control",
    input: testCase.text, note: testCase.note ?? "", warmup,
  };
  try {
    const result = await backend.classify(BENCH_ITEM, testCase.text, {
      abstain, signal: abort.signal,
    });
    const { verdict, detail } = scoreCase(testCase, { result });
    return {
      ...base, ms: Math.round(performance.now() - started),
      pole: result.pole, abstained: result.abstained,
      confidence: result.confidence, rationale: result.rationale,
      repairs: result.repairs, verdict, detail,
    };
  } catch (err) {
    if (isAbort(err)) return { ...base, ms: 0, verdict: "error", detail: "aborted", repairs: [] };
    const { verdict, detail } = scoreCase(testCase, { error: err.code ?? "ERROR" });
    return {
      ...base, ms: Math.round(performance.now() - started),
      pole: null, abstained: false, confidence: null,
      rationale: err.message, repairs: [], verdict, detail,
    };
  }
}

function finish() {
  $("start").disabled = false;
  $("stop").hidden = true;
  abort = null;
  render();
}

/* ---------- render ---------- */

const VERDICT_CLASS = { pass: "ok", fail: "bad", soft: "warn", error: "warn" };

function appendRow(row) {
  if (!$("rows").children.length) {
    $("rows").innerHTML = `<tr><th>case</th><th>arm</th><th>verdict</th>`
      + `<th>outcome</th><th>conf</th><th>repairs</th><th>ms</th></tr>`;
  }
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><code>${row.caseId}</code><br><span class="note">${row.category}</span></td>
    <td class="note">${row.arm}</td>
    <td><span class="${VERDICT_CLASS[row.verdict]}">${row.verdict}</span></td>
    <td>${row.detail}</td>
    <td>${row.confidence == null ? "—" : row.confidence.toFixed(2)}</td>
    <td class="note">${(row.repairs ?? []).join(", ") || "—"}</td>
    <td>${row.ms || "—"}</td>`;
  $("rows").appendChild(tr);
}

function render() {
  if (!rows.length) { $("summary").textContent = "Nothing run yet."; return; }

  const arms = [...new Set(rows.map((r) => r.arm))];
  const blocks = arms.map((arm) => {
    const s = summarize(rows.filter((r) => r.arm === arm));
    const cats = Object.entries(s.byCategory)
      .map(([name, b]) => `${name} ${b.pass}/${b.pass + b.fail}`).join(" · ");
    const repairs = Object.entries(s.repairCounts)
      .sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(", ") || "none";
    return `<dl>
      <dt>Arm</dt><dd><strong>${arm === "abstain" ? "abstention offered" : "phase 1 control"}</strong></dd>
      <dt>Scored</dt><dd>${s.passed} / ${s.scored} passed${s.passRate == null ? "" : ` — ${Math.round(s.passRate * 100)}%`}</dd>
      <dt>By category</dt><dd>${cats}</dd>
      <dt>Declined</dt><dd>${s.abstentions} of ${s.total}</dd>
      <dt>Unscored</dt><dd>${s.soft} soft · ${s.errors} error</dd>
      <dt>Repairs</dt><dd>${repairs}</dd>
      <dt>Median</dt><dd>${s.medianMs ?? "—"} ms</dd>
    </dl>`;
  }).join("");

  $("summary").innerHTML = blocks;
  $("export").value = JSON.stringify({
    ranAt: new Date().toISOString(),
    backend: backend?.id, model: backend?.model,
    item: BENCH_ITEM.id, rows,
  }, null, 2);
}

/* ---------- wiring ---------- */

document.querySelectorAll('input[name="backend"]').forEach((el) =>
  el.addEventListener("change", syncBackendChoice));
$("start").addEventListener("click", start);
$("stop").addEventListener("click", () => abort?.abort());

boot();
