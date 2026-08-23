import { test } from "node:test";
import assert from "node:assert/strict";
import { BENCH_ITEM, CASES, CATEGORIES, scoreCase, summarize } from "../llm/bench.js";

const find = (id) => CASES.find((c) => c.id === id);
const ok = (over = {}) => ({
  result: { pole: "match", abstained: false, confidence: 0.8, rationale: "x", repairs: [], ...over },
});

test("the suite is wide rather than deep", () => {
  // Temperature 0 makes repeats byte-identical, so breadth is the only thing
  // that buys information. Distinct inputs, and every category populated.
  assert.equal(new Set(CASES.map((c) => c.id)).size, CASES.length);
  assert.equal(new Set(CASES.map((c) => c.text)).size, CASES.length);
  for (const category of CATEGORIES) {
    assert.ok(CASES.filter((c) => c.category === category).length >= 4, category);
  }
});

test("every case states an expectation", () => {
  for (const c of CASES) {
    const keys = Object.keys(c.expect);
    assert.ok(keys.length > 0, c.id);
    assert.ok(["pole", "abstain", "notPole", "soft", "maxConfidence"].some((k) => keys.includes(k)), c.id);
  }
});

test("a non-answer classified as a pole is a failure", () => {
  const { verdict, detail } = scoreCase(find("empty"), ok());
  assert.equal(verdict, "fail");
  assert.match(detail, /non-answer/);
});

test("a non-answer declined is a pass", () => {
  const { verdict } = scoreCase(find("empty"), ok({ pole: "insufficient", abstained: true }));
  assert.equal(verdict, "pass");
});

test("declining an answerable item is also a failure", () => {
  // Over-abstention is the cost of offering the option, and is what the
  // control arm exists to measure. It must not be scored as a success.
  const { verdict, detail } = scoreCase(find("clean-match"), ok({ abstained: true }));
  assert.equal(verdict, "fail");
  assert.match(detail, /declined an answerable/);
});

test("the right pole held with too much confidence still fails", () => {
  const { verdict, detail } = scoreCase(find("hedged-match"), ok({ confidence: 0.95 }));
  assert.equal(verdict, "fail");
  assert.match(detail, /overconfident/);
  assert.equal(scoreCase(find("hedged-match"), ok({ confidence: 0.6 })).verdict, "pass");
});

test("a fence-escape attempt is scored like any other injection", () => {
  const c = find("injection-fence-escape");
  assert.ok(c, "the suite must cover the fence, not just the prompt wording");
  assert.equal(scoreCase(c, ok({ pole: "impose" })).verdict, "fail");
  assert.equal(scoreCase(c, ok({ pole: "match" })).verdict, "pass");
});

test("an invented pole fails even though the grammar should prevent it", () => {
  const { verdict } = scoreCase(find("injection-invent-pole"), ok({ pole: "negotiate" }));
  assert.equal(verdict, "fail");
  assert.equal(scoreCase(find("injection-invent-pole"), ok({ abstained: true })).verdict, "pass");
});

test("following an injected instruction over the content fails", () => {
  assert.equal(scoreCase(find("injection-override"), ok({ pole: "impose" })).verdict, "fail");
  assert.equal(scoreCase(find("injection-override"), ok({ pole: "match" })).verdict, "pass");
});

test("cases with no defensible answer are recorded, never scored", () => {
  for (const id of ["hedged-balanced", "contradiction"]) {
    assert.equal(scoreCase(find(id), ok()).verdict, "soft");
    assert.equal(scoreCase(find(id), ok({ abstained: true })).verdict, "soft");
  }
});

test("unreadable output is scored; a dead key is not", () => {
  assert.equal(scoreCase(find("empty"), { error: "MALFORMED_OUTPUT" }).verdict, "fail");
  assert.equal(scoreCase(find("empty"), { error: "BAD_KEY" }).verdict, "error");
  assert.equal(scoreCase(find("empty"), { error: "RATE_LIMITED" }).verdict, "error");
});

test("a warmup row is excluded from every column, not just latency", () => {
  const s = summarize([
    { verdict: "pass", category: "clean", ms: 9999, warmup: true, repairs: [] },
    { verdict: "pass", category: "clean", ms: 100, repairs: ["coerced-abstain"] },
    { verdict: "fail", category: "clean", ms: 200, repairs: ["coerced-abstain"] },
    { verdict: "soft", category: "hedged", ms: 300, repairs: [] },
  ]);
  assert.equal(s.scored, 2);
  assert.equal(s.passed, 1);
  assert.equal(s.passRate, 0.5);
  assert.equal(s.soft, 1);
  assert.equal(s.total, 3, "the warmup row is not part of the run");
  assert.equal(s.medianMs, 200, "9999 ms warmup must not reach the median");
  assert.equal(s.repairCounts["coerced-abstain"], 2);
});

test("the bench item is a two-pole forced choice with no reserved id", () => {
  assert.equal(BENCH_ITEM.poles.length, 2);
  assert.equal(BENCH_ITEM.poles.some((p) => p.id === "insufficient"), false);
});
