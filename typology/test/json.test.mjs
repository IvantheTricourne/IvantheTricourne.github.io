import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractJsonObject, coerceConfidence, coercePole, parseClassification,
} from "../llm/json.js";

const item = {
  poles: [
    { id: "match", label: "Match the file" },
    { id: "impose", label: "Use your own style" },
  ],
};
const parse = (text) => parseClassification(text, item);

test("extracts a bare object", () => {
  assert.equal(extractJsonObject('{"a":1}'), '{"a":1}');
});

test("ignores braces inside string values", () => {
  const src = '{"rationale":"they said {nope} out loud"}';
  assert.equal(extractJsonObject(src), src);
});

test("survives escaped quotes", () => {
  const src = '{"rationale":"they said \\"no\\" firmly"}';
  assert.equal(extractJsonObject(src), src);
});

test("returns null when the object never closes (truncated output)", () => {
  assert.equal(extractJsonObject('{"pole":"match"'), null);
});

test("confidence: percentages, words, and strings all land in 0..1", () => {
  assert.equal(coerceConfidence(0.8), 0.8);
  assert.equal(coerceConfidence(87), 0.87);
  assert.equal(coerceConfidence("87%"), 0.87);
  assert.equal(coerceConfidence("high"), 0.85);
  assert.equal(coerceConfidence(4), 0.04);
  assert.equal(coerceConfidence(-5), 0);
  assert.equal(coerceConfidence("banana"), null);
  assert.equal(coerceConfidence(undefined), null);
});

test("pole resolves from id, label, and casing", () => {
  assert.equal(coercePole("match", item.poles), "match");
  assert.equal(coercePole("  MATCH ", item.poles), "match");
  assert.equal(coercePole("Match the file", item.poles), "match");
  assert.equal(coercePole("I think they would match the file", item.poles), "match");
});

test("pole refuses ambiguity rather than guessing", () => {
  // Mentions both poles; picking one would produce a confident wrong answer.
  assert.equal(coercePole("could match the file or use your own style", item.poles), null);
  assert.equal(coercePole("neither really", item.poles), null);
});

test("clean output needs no repairs", () => {
  const r = parse('{"pole":"match","confidence":0.9,"rationale":"defers to the file"}');
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    pole: "match", abstained: false, confidence: 0.9, rationale: "defers to the file",
  });
  assert.deepEqual(r.repairs, []);
});

test("recovers from a fenced, prefaced, trailing-comma response", () => {
  const r = parse('Sure!\n```json\n{"pole": "Match the file", "confidence": 87, "rationale": "x",}\n```');
  assert.equal(r.ok, true);
  assert.equal(r.value.pole, "match");
  assert.equal(r.value.confidence, 0.87);
  assert.ok(r.repairs.includes("extracted-from-prose"));
  assert.ok(r.repairs.includes("relaxed-trailing-comma"));
  assert.ok(r.repairs.includes("coerced-pole"));
});

test("accepts aliased keys models reach for", () => {
  const r = parse('{"choice":"impose","confidence":"low","rationale":"reformats"}');
  assert.equal(r.ok, true);
  assert.equal(r.value.pole, "impose");
  assert.ok(r.repairs.includes("aliased-pole-key"));
});

test("defaults a missing confidence rather than failing", () => {
  const r = parse('{"pole":"match","rationale":"sure"}');
  assert.equal(r.ok, true);
  assert.equal(r.value.confidence, 0.5);
  assert.ok(r.repairs.includes("defaulted-confidence"));
});

test("truncates a runaway rationale", () => {
  const r = parse(`{"pole":"match","confidence":0.5,"rationale":"${"x".repeat(600)}"}`);
  assert.equal(r.ok, true);
  assert.equal(r.value.rationale.length, 400);
  assert.ok(r.repairs.includes("truncated-rationale"));
});

test("a long but legitimate rationale is left intact", () => {
  // The cap was 240, which clipped 6 of Qwen3 1.7B's 19 abstain rationales.
  // It explains a refusal at length, so the cap was truncating the reasoning
  // rather than catching a runaway — the repair tag was firing on normal use.
  const r = parse(`{"pole":"insufficient","confidence":0.1,"rationale":"${"y".repeat(300)}"}`);
  assert.equal(r.value.rationale.length, 300);
  assert.deepEqual(r.repairs, []);
});

test("fails cleanly on unusable input", () => {
  assert.deepEqual(parse("I'd say they match the file.").reason, "no-json-object");
  assert.deepEqual(parse('{"pole":"match"').reason, "no-json-object");
  assert.deepEqual(parse('{"pole":"sideways","confidence":1}').reason, "unresolvable-pole");
  assert.deepEqual(parse("").reason, "no-json-object");
});

test("a hallucinated pole is never silently accepted", () => {
  const r = parse('{"pole":"tabs","confidence":0.99,"rationale":"confident nonsense"}');
  assert.equal(r.ok, false);
});

/* ---------- abstention (#25) ---------- */

test("the abstain sentinel resolves and is flagged", () => {
  const r = parse('{"pole":"insufficient","confidence":0.1,"rationale":"no answer given"}');
  assert.equal(r.ok, true);
  assert.equal(r.value.pole, "insufficient");
  assert.equal(r.value.abstained, true);
  assert.deepEqual(r.repairs, []);
});

test("a real pole is never flagged as abstained", () => {
  const r = parse('{"pole":"impose","confidence":0.8,"rationale":"reformats"}');
  assert.equal(r.value.abstained, false);
});

test("a refusal in the model's own words maps onto the sentinel", () => {
  // Safe direction: the worst case turns a malformed response into an
  // abstention, which cannot manufacture a pole the person never chose.
  for (const word of ["unknown", "N/A", "cannot determine", "indeterminate"]) {
    const r = parse(`{"pole":${JSON.stringify(word)},"confidence":0.1,"rationale":"x"}`);
    assert.equal(r.ok, true, `${word} should resolve`);
    assert.equal(r.value.abstained, true, `${word} should abstain`);
    assert.ok(r.repairs.includes("coerced-abstain"));
  }
});

test("refusing without an abstain option is recorded as its own outcome", () => {
  // The Phase 1 contract. Not a parse failure in any interesting sense — the
  // model understood the task and declined, and the schema had no slot for it.
  const r = parseClassification(
    '{"pole":"unknown","confidence":0.1,"rationale":"x"}', item, { abstain: false });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "refused-without-abstain");
});

test("the sentinel is not accepted when abstention was not offered", () => {
  const r = parseClassification(
    '{"pole":"insufficient","confidence":0.1,"rationale":"x"}', item, { abstain: false });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "refused-without-abstain");
});

test("a hallucinated pole is still unresolvable, not an abstention", () => {
  const r = parse('{"pole":"negotiate","confidence":0.9,"rationale":"x"}');
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unresolvable-pole");
});
