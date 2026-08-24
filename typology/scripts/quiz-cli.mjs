/**
 * The quiz, headless.
 *
 * `bench-cli.mjs` exists because the *prompt* could only be settled empirically
 * and every iteration cost a human a browser session. This is the same trick
 * one layer up: the twelve-item run, the gate, and the scoring, driven from
 * node against an OpenAI-compatible endpoint instead of WebLLM.
 *
 * The specific thing it exists to answer: **both real quiz runs reported
 * `abstained: 0`.** Phase 2 built the abstention path, #33 taught the scorer to
 * report what nothing reached, and 114 bench runs have exercised abstention —
 * but the product itself never has, so nobody has seen a blank answer travel
 * all the way through to `evidence.unmeasured`. A bench case cannot show that;
 * it stops at one item and never scores a profile.
 *
 * WHAT THIS DOES NOT COVER. It is the same pipeline, not the same stack: the
 * WebLLM backend, xgrammar's constrained decoding (llama.cpp is handed the same
 * schema and builds a GBNF grammar from it), and the DOM are all untested here.
 * A green run means the quiz's *logic* handles a non-answer, not that the
 * browser does.
 *
 *   node scripts/quiz-cli.mjs --model qwen3-1.7b-q4.gguf --blank fn-correctness
 *   node scripts/quiz-cli.mjs --blank fn-correctness --offtopic en-others --json
 *
 * `--blank` sends an empty answer, which the model should decline. `--offtopic`
 * sends prose that does not address the question, which is the harder case —
 * Phase 2 measured models inferring an answer from the *question* when the
 * answer gave them nothing. `--skip` never calls the model at all, mirroring
 * the quiz's skip button.
 */
import { BASE_ITEMS, GATED_ITEMS, shouldAsk, applyAnswer } from "../llm/items.js";
import { scoreAll } from "../llm/scoring.js";
import { schemaFor, systemPrompt, userPrompt } from "../llm/contract.js";
import { parseClassification } from "../llm/json.js";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const idList = (name) => (arg(name, "") || "").split(",").map((s) => s.trim()).filter(Boolean);

const ENDPOINT = arg("endpoint", "http://127.0.0.1:8080/v1/chat/completions");
const MODEL = arg("model", "local");
const KEY = arg("key", process.env.LLM_API_KEY ?? "");
const ABSTAIN_ARM = arg("arm", "abstain") !== "control";
const JSON_OUT = argv.includes("--json");

const BLANK = new Set(idList("blank"));
const OFFTOPIC = new Set(idList("offtopic"));
const SKIP = new Set(idList("skip"));

const OFFTOPIC_TEXT = "Honestly I've been thinking about lunch. There's a place near the office that does a decent banh mi.";

/**
 * One coherent person, so the run produces a profile rather than noise.
 *
 * Written to lean Ti-dominant with an 8-ish core: the point is not that the
 * answers are subtle, it is that a correct pipeline should reproduce roughly
 * this shape, so a wrong one is visible. Deliberately prose, not keywords —
 * `clean-match-indirect` in the bench exists because models handle "whatever
 * the project already does wins" differently from "I match the file".
 */
const ANSWERS = {
  "fn-open-problem": "I sit with it for a while until the underlying thing clicks. Sketching options early just gives me a pile of shapes I have to throw away.",
  "fn-unfamiliar-system": "I run it and break it. Reading about it tells me what someone intended, not what it does.",
  "fn-correctness": "If the model in my head is wrong then the tests are just not exercising the wrong part yet. I hold it.",
  "fn-disagreement": "I say so. I can't sit there nodding along when I think it's wrong, it eats at me.",
  "fn-abstraction": "Give me the shape of it first. I'll ask for the worked example if the shape doesn't land.",
  "fn-decision-basis": "Which one actually holds up. If it's sound I can bring people round to it, the other way round doesn't work.",
  "fn-energy": "I'd tackle it solo. I think better when I'm not performing the thinking for someone.",
  "fn-closure": "I'd switch. Finishing something I already know is the worse approach is just sunk cost with extra steps.",
  "en-standards": "That someone asks the one question I haven't thought about and I'm standing there with nothing.",
  "en-others": "I end up being the one who says what's actually going wrong. Somebody has to put it on the table.",
  "en-constraint": "I want to know who decided and why they get to. Not the decision necessarily, the standing.",
  "en-pressure": "I take the whole thing on myself rather than watch it go wrong. Then I'm the bottleneck.",
};

async function classify(item, text) {
  const body = {
    model: MODEL,
    temperature: 0,
    max_tokens: 512,
    stream: false,
    response_format: {
      type: "json_schema",
      json_schema: { name: "classification", schema: schemaFor(item, { abstain: ABSTAIN_ARM }), strict: true },
    },
    // Same reason as bench-cli: the browser build does not emit <think>, so
    // leaving it on would drive a different model's behaviour through the quiz.
    chat_template_kwargs: { enable_thinking: false },
    messages: [
      { role: "system", content: systemPrompt({ abstain: ABSTAIN_ARM }) },
      { role: "user", content: userPrompt(item, text) },
    ],
  };
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const json = await res.json();
  const raw = json.choices?.[0]?.message?.content ?? "";
  const parsed = parseClassification(raw, item, { abstain: ABSTAIN_ARM });
  if (!parsed.ok) throw new Error(`unreadable output (${parsed.reason}): ${raw.slice(0, 120)}`);
  return { ...parsed.value, repairs: parsed.repairs };
}

function answerFor(item) {
  if (BLANK.has(item.id)) return "";
  if (OFFTOPIC.has(item.id)) return OFFTOPIC_TEXT;
  return ANSWERS[item.id] ?? "";
}

/* ---------- the run loop, mirroring quiz-app.js ---------- */

let queue = [...BASE_ITEMS];
let index = 0;
let tables = {};
let answered = 0;
let abstained = 0;
const transcript = [];

const log = (...a) => { if (!JSON_OUT) console.log(...a); };

log(`endpoint  ${ENDPOINT}`);
log(`model     ${MODEL}`);
log(`arm       ${ABSTAIN_ARM ? "abstain" : "control"}`);
if (BLANK.size) log(`blank     ${[...BLANK].join(", ")}`);
if (OFFTOPIC.size) log(`offtopic  ${[...OFFTOPIC].join(", ")}`);
if (SKIP.size) log(`skipped   ${[...SKIP].join(", ")}`);
log("");

while (index < queue.length) {
  const item = queue[index];

  if (SKIP.has(item.id)) {
    abstained += 1;
    transcript.push({ item: item.id, answer: null, pole: null, skipped: true });
  } else {
    const answer = answerFor(item);
    const started = Date.now();
    let out;
    try {
      out = await classify(item, answer);
    } catch (err) {
      console.error(`\n${item.id}: ${err.message}`);
      process.exit(1);
    }
    const ms = Date.now() - started;

    if (out.abstained) {
      abstained += 1;
    } else {
      applyAnswer(tables, item, out.pole);
      answered += 1;
    }
    transcript.push({
      item: item.id, answer, pole: out.pole, abstained: out.abstained,
      confidence: out.confidence, rationale: out.rationale, repairs: out.repairs, ms,
    });

    const tag = out.abstained ? "DECLINED" : (item.poles.find((p) => p.id === out.pole)?.label ?? out.pole);
    const why = answer === "" ? " [blank]" : OFFTOPIC.has(item.id) ? " [off-topic]" : "";
    log(`${String(index + 1).padStart(2)}. ${item.id.padEnd(20)} ${tag.padEnd(24)} ${out.confidence.toFixed(2)}  ${ms}ms${why}`);
    if (out.abstained || why) log(`    "${out.rationale}"`);
  }

  index += 1;
  // Gates are evaluated once the ungated items are done, exactly as the page
  // does it — a tie-break item asked against complete evidence.
  if (index === queue.length && queue.length === BASE_ITEMS.length) {
    const gated = GATED_ITEMS.filter((i) => shouldAsk(i, tables));
    if (gated.length) log(`\n-- gate fired: ${gated.map((i) => i.id).join(", ")} --`);
    else log(`\n-- no gate fired --`);
    queue = [...queue, ...gated];
  }
}

const result = scoreAll({
  functions: tables.functions ?? {},
  enneagram: tables.enneagram ?? {},
  answered, abstained,
});

if (JSON_OUT) {
  console.log(JSON.stringify({ ...result, backend: { id: "cli", model: MODEL }, transcript }, null, 2));
} else {
  console.log("");
  console.log(JSON.stringify(result, null, 2));
  console.log("");
  console.log(`answered ${answered}   abstained ${abstained}   of ${queue.length}`);
  const unmeasured = result.evidence?.unmeasured ?? [];
  console.log(`unmeasured  ${unmeasured.length ? unmeasured.join(", ") : "(none)"}`);
}
