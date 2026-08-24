import { test } from "node:test";
import assert from "node:assert/strict";
import { ITEMS, BASE_ITEMS, GATED_ITEMS, margin, shouldAsk, applyAnswer } from "../llm/items.js";
import { FUNCTIONS, CENTERS } from "../llm/scoring.js";
import { ABSTAIN } from "../llm/contract.js";

test("every function and every enneagram type is reachable", () => {
  // A weight table that cannot reach a function makes that stack position
  // unreachable too, which would be invisible until someone hit it.
  const hit = (scale) => new Set(
    ITEMS.filter((i) => i.scale === scale)
      .flatMap((i) => i.poles.flatMap((p) => Object.keys(p.weights ?? {}))),
  );
  assert.deepEqual([...hit("functions")].sort(), [...FUNCTIONS].sort());
  const types = Object.values(CENTERS).flat().map(String).sort();
  assert.deepEqual([...hit("enneagram")].sort(), types);
});

test("items are well formed and uniquely identified", () => {
  assert.equal(new Set(ITEMS.map((i) => i.id)).size, ITEMS.length);
  for (const item of ITEMS) {
    assert.ok(item.prompt?.length > 10, `${item.id} prompt`);
    assert.ok(item.poles.length >= 2, `${item.id} needs a forced choice`);
    assert.equal(new Set(item.poles.map((p) => p.id)).size, item.poles.length, `${item.id} pole ids`);
    for (const pole of item.poles) {
      assert.ok(pole.label?.length, `${item.id}/${pole.id} label`);
      assert.ok(Object.keys(pole.weights ?? {}).length > 0, `${item.id}/${pole.id} weights`);
      assert.notEqual(pole.id, ABSTAIN, `${item.id} must not shadow the reserved id`);
    }
  }
});

test("weights only name keys their own scale can score", () => {
  for (const item of ITEMS) {
    const legal = item.scale === "functions"
      ? FUNCTIONS
      : Object.values(CENTERS).flat().map(String);
    for (const pole of item.poles) {
      for (const key of Object.keys(pole.weights)) {
        assert.ok(legal.includes(key), `${item.id}/${pole.id} weights unknown key ${key}`);
      }
    }
  }
});

test("an empty score table reads as unresolved, not as decided", () => {
  // The subtle one. If margin() returned Infinity for an empty table, every
  // gated item would be skipped precisely when it was most needed.
  assert.equal(margin({}), 0);
  assert.equal(margin({ 5: 4 }), 0, "one entry is still no contest");
  assert.equal(margin({ 5: 4, 4: 1 }), 3);
  assert.equal(margin({ 5: 4, 4: 1, 6: 0 }), 3, "zeroes are not contenders");
});

test("gated items are asked only while the question is still open", () => {
  const gated = GATED_ITEMS[0];
  assert.ok(gated, "the bank should demonstrate the gate");
  assert.equal(shouldAsk(gated, { enneagram: { 5: 6, 4: 1 } }), false, "settled — skip");
  assert.equal(shouldAsk(gated, { enneagram: { 5: 4, 4: 3 } }), true, "close — ask");
  assert.equal(shouldAsk(gated, { enneagram: {} }), true, "nothing yet — ask");
  for (const item of BASE_ITEMS) {
    assert.equal(shouldAsk(item, { enneagram: {} }), true, `${item.id} is ungated`);
  }
});

test("answers accumulate into the scale the item names", () => {
  const tables = {};
  const item = ITEMS.find((i) => i.id === "fn-open-problem");
  assert.equal(applyAnswer(tables, item, "ni"), true);
  assert.equal(applyAnswer(tables, item, "ni"), true);
  assert.equal(tables.functions.Ni, 4);
  assert.equal(tables.enneagram, undefined, "an unrelated scale stays untouched");
});

test("an unknown pole is refused rather than scored as zero", () => {
  const tables = {};
  const item = ITEMS.find((i) => i.id === "fn-open-problem");
  assert.equal(applyAnswer(tables, item, ABSTAIN), false);
  assert.equal(applyAnswer(tables, item, "nonsense"), false);
  assert.deepEqual(tables, {}, "a refused answer must not create the table");
});
