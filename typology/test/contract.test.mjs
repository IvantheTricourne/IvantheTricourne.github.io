import { test } from "node:test";
import assert from "node:assert/strict";
import { ABSTAIN, allowedPoleIds, schemaFor, systemPrompt } from "../llm/contract.js";

const item = {
  id: "t", prompt: "Which?",
  poles: [{ id: "a", label: "Alpha" }, { id: "b", label: "Bravo" }],
};

test("the schema offers abstention by default", () => {
  assert.deepEqual(schemaFor(item).properties.pole.enum, ["a", "b", ABSTAIN]);
});

test("the control arm reproduces the Phase 1 schema exactly", () => {
  // Pinned because #25 measures against it: if the control drifts, the
  // over-abstention rate it is supposed to establish becomes meaningless.
  assert.deepEqual(schemaFor(item, { abstain: false }), {
    type: "object",
    properties: {
      pole: { type: "string", enum: ["a", "b"] },
      confidence: { type: "number" },
      rationale: { type: "string" },
    },
    required: ["pole", "confidence", "rationale"],
    additionalProperties: false,
  });
});

test("an item that reuses the reserved id is refused, not silently shadowed", () => {
  const clash = { id: "clash", poles: [{ id: "a" }, { id: ABSTAIN }] };
  assert.throws(() => allowedPoleIds(clash), /reserved id/);
  // Without abstention there is no sentinel to collide with.
  assert.deepEqual(allowedPoleIds(clash, { abstain: false }), ["a", ABSTAIN]);
});

test("the abstain prompt tells the model not to infer from the question", () => {
  const p = systemPrompt();
  assert.ok(p.includes(`"${ABSTAIN}"`));
  assert.ok(/do not infer an answer from the/i.test(p));
  assert.equal(/pick the closest pole/i.test(p), false);
});

test("the control prompt keeps the instruction that caused the defect", () => {
  // Phase 1 did not merely fail to offer abstention — it instructed the model
  // to fabricate a choice. Qwen obeyed exactly, landing on 0.2. Kept verbatim
  // so the control measures Phase 1 as shipped, not a cleaned-up version.
  const p = systemPrompt({ abstain: false });
  assert.ok(/pick the closest pole/i.test(p));
  assert.ok(/set confidence below 0\.2/i.test(p));
  assert.equal(p.includes(ABSTAIN), false);
});
