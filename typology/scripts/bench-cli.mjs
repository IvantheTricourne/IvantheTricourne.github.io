/**
 * Run the #25 measurement suite from the command line, against any
 * OpenAI-compatible endpoint.
 *
 * WHY THIS EXISTS, AND WHAT IT IS NOT
 *
 * The browser harness needs WebGPU, which build environments do not have, so
 * every prompt change has cost a human a manual run. That made iteration
 * expensive enough to discourage it, which is the wrong incentive for the one
 * part of this project that can only be settled empirically.
 *
 * This closes that loop by reusing everything that is actually under test —
 * `systemPrompt`, `userPrompt`, `schemaFor`, `parseClassification`, `CASES`,
 * `scoreCase` — and swapping only the transport. What it measures is the
 * prompt and the parser.
 *
 * It is NOT a substitute for a real run. It differs from the shipped path in
 * three ways that matter:
 *
 *   engine        llama.cpp, not WebLLM/TVM
 *   quantisation  Q4_K_M, not q4f16_1
 *   grammar       GBNF, not xgrammar
 *   determinism   none — see below
 *
 * So "the abstain instruction lands" transfers; "xgrammar accepts our schema"
 * does not. Milestone verification stays a browser run on real hardware.
 *
 * DETERMINISM. WebLLM at temperature 0 returns byte-identical output for a
 * repeated input — verified twice in the browser. llama.cpp's server does not:
 * continuous batching changes the order of floating-point reductions, so close
 * calls flip between runs. Measured here, one input in four disagreed with
 * itself. A single run therefore cannot support a one-case delta, which is
 * what `--repeat` exists to prevent: it runs each case N times, scores the
 * modal verdict, and flags any case that disagreed with itself.
 *
 * ARMS. Two independent switches, crossed:
 *
 *   --arm    abstain | control | both   the #25 question: does offering
 *                                       "insufficient" help or cost?
 *   --fence  on | markers | off | all   the #27 question: what does #31's
 *           (also: both = on,off)        injection hardening cost, and which
 *                                        half of it is charging?
 *
 * The fence arm only moves the adversarial category by design; if it moves
 * `clean` or `hedged`, that is the cost the open question is asking about.
 *
 * `markers` is the arm #32's result asked for. It keeps the fence markers and
 * the stripping — the structural guarantee — and drops the exhortation that
 * declares the region data rather than instruction. #32 measured `on`
 * declining 7/21 against `off`'s 11/21, and the exhortation is the half that
 * plausibly causes that, so `markers` is what separates structure from
 * suppression. Read it against both neighbours, not against `on` alone.
 *
 *   node scripts/bench-cli.mjs --endpoint http://127.0.0.1:8080/v1/chat/completions \
 *                              --model qwen3-1.7b --arm both --fence both
 */
import { BENCH_ITEM, CASES, scoreCase, summarize } from "../llm/bench.js";
import { schemaFor, systemPrompt, userPrompt } from "../llm/contract.js";
import { parseClassification } from "../llm/json.js";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const ENDPOINT = arg("endpoint", "http://127.0.0.1:8080/v1/chat/completions");
const MODEL = arg("model", "local");
const ARM = arg("arm", "both");
const FENCE = arg("fence", "on");
const KEY = arg("key", process.env.LLM_API_KEY ?? "");
const LIMIT = Number(arg("limit", "0")) || CASES.length;
const REPEAT = Math.max(1, Number(arg("repeat", "1")) || 1);
const JSON_OUT = argv.includes("--json");

const abstainArms = ARM === "both" ? [true, false] : [ARM !== "control"];

// Each fence mode is a (fence, exhort) pair. `both` stays what it meant in #32
// — the two ends — so a repeated run reproduces those numbers.
const FENCE_MODES = {
  on: { fence: true, exhort: true },
  markers: { fence: true, exhort: false },
  off: { fence: false, exhort: false },
};
const FENCE_ALIASES = { both: "on,off", all: "on,markers,off" };
const fenceNames = (FENCE_ALIASES[FENCE] ?? FENCE).split(",").map((n) => n.trim());
for (const name of fenceNames) {
  if (!FENCE_MODES[name]) {
    console.error(`--fence: unknown mode "${name}". Use ${Object.keys(FENCE_MODES).join(" | ")}, both, or all.`);
    process.exit(2);
  }
}

// Crossed, abstain outermost, so a multi-mode run reads as groups.
const arms = abstainArms.flatMap((abstain) =>
  fenceNames.map((name) => ({ abstain, name, ...FENCE_MODES[name] })));
const armLabel = ({ abstain, name }) =>
  `${abstain ? "abstain" : "control"}${fenceNames.length > 1 ? `+${name}` : ""}`;

async function classify(item, text, { abstain, fence, exhort }) {
  const body = {
    model: MODEL,
    temperature: 0,
    max_tokens: 512,
    stream: false,
    // llama.cpp understands json_schema here; providers that do not simply
    // fall back to unconstrained JSON, which json.js is built to survive.
    response_format: {
      type: "json_schema",
      json_schema: { name: "classification", schema: schemaFor(item, { abstain }), strict: true },
    },
    // Qwen3 emits <think> blocks unless told otherwise. The browser build does
    // not, so leaving it on would measure a different model's behaviour.
    chat_template_kwargs: { enable_thinking: false },
    messages: [
      { role: "system", content: systemPrompt({ abstain, fence, exhort }) },
      { role: "user", content: userPrompt(item, text, { fence, exhort }) },
    ],
  };
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

const rows = [];
// One throwaway pass: the first call pays prompt-processing warmup here just as
// it pays compile and prefill in the browser.
try { await classify(BENCH_ITEM, CASES[0].text, arms[0]); } catch { /* reported by the real run */ }

for (const arm of arms) {
  for (const testCase of CASES.slice(0, LIMIT)) {
    const base = {
      caseId: testCase.id, category: testCase.category,
      arm: armLabel(arm), abstainArm: arm.abstain, fenceArm: arm.name,
      input: testCase.text,
    };
    const attempts = [];
    for (let n = 0; n < REPEAT; n++) {
      const started = Date.now();
      try {
        const raw = await classify(BENCH_ITEM, testCase.text, arm);
        const parsed = parseClassification(raw, BENCH_ITEM, { abstain: arm.abstain });
        if (!parsed.ok) {
          const { verdict, detail } = scoreCase(testCase, { error: "MALFORMED_OUTPUT" });
          attempts.push({ ...base, ms: Date.now() - started, verdict,
                          detail: `${detail} (${parsed.reason})`, repairs: parsed.repairs });
        } else {
          const { verdict, detail } = scoreCase(testCase, { result: parsed.value });
          attempts.push({ ...base, ms: Date.now() - started, ...parsed.value,
                          repairs: parsed.repairs, verdict, detail });
        }
      } catch (err) {
        attempts.push({ ...base, ms: Date.now() - started, verdict: "error", detail: err.message, repairs: [] });
      }
    }
    // The modal verdict is scored; the spread is reported, because a case that
    // disagrees with itself is a finding rather than a number to average away.
    const counts = {};
    for (const a of attempts) counts[a.verdict] = (counts[a.verdict] ?? 0) + 1;
    const modal = Object.entries(counts).sort((x, y) => y[1] - x[1])[0][0];
    const chosen = attempts.find((a) => a.verdict === modal);
    const stable = counts[modal] === attempts.length;
    rows.push({ ...chosen, attempts: attempts.length,
                agreement: counts[modal] / attempts.length, stable });
    if (!JSON_OUT) {
      const r = rows.at(-1);
      const mark = { pass: "ok  ", fail: "FAIL", soft: "soft", error: "ERR " }[r.verdict];
      const flag = stable ? "" : `  [unstable ${counts[modal]}/${attempts.length}]`;
      process.stdout.write(`${mark} ${r.arm.padEnd(14)} ${r.caseId.padEnd(24)} ${r.detail}${flag}\n`);
    }
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ endpoint: ENDPOINT, model: MODEL, rows }, null, 2));
} else {
  for (const arm of [...new Set(rows.map((r) => r.arm))]) {
    const s = summarize(rows.filter((r) => r.arm === arm));
    const cats = Object.entries(s.byCategory)
      .map(([n, b]) => `${n} ${b.pass}/${b.pass + b.fail}`).join("  ");
    const repairs = Object.entries(s.repairCounts).map(([k, v]) => `${k}x${v}`).join(", ") || "none";
    console.log(`\n--- ${arm}`);
    console.log(`  scored     ${s.passed}/${s.scored}${s.passRate == null ? "" : `  (${Math.round(s.passRate * 100)}%)`}`);
    console.log(`  category   ${cats}`);
    console.log(`  declined   ${s.abstentions}/${s.total}`);
    console.log(`  unscored   ${s.soft} soft, ${s.errors} error`);
    console.log(`  repairs    ${repairs}`);
    console.log(`  median     ${s.medianMs} ms`);
    const shaky = rows.filter((r) => r.arm === arm && r.stable === false);
    if (shaky.length) console.log(`  UNSTABLE   ${shaky.length}: ${shaky.map((r) => r.caseId).join(", ")}`);
  }
}
