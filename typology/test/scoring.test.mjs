import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FUNCTIONS, functionStack, mbtiFromStack, enneagramFrom, wingsOf, CENTERS, scoreAll, contest,
} from "../llm/scoring.js";

/** The sixteen canonical ego stacks. The derivation must reproduce all of them. */
const CANONICAL = {
  ISTJ: ["Si", "Te", "Fi", "Ne"], ISFJ: ["Si", "Fe", "Ti", "Ne"],
  INFJ: ["Ni", "Fe", "Ti", "Se"], INTJ: ["Ni", "Te", "Fi", "Se"],
  ISTP: ["Ti", "Se", "Ni", "Fe"], ISFP: ["Fi", "Se", "Ni", "Te"],
  INFP: ["Fi", "Ne", "Si", "Te"], INTP: ["Ti", "Ne", "Si", "Fe"],
  ESTP: ["Se", "Ti", "Fe", "Ni"], ESFP: ["Se", "Fi", "Te", "Ni"],
  ENFP: ["Ne", "Fi", "Te", "Si"], ENTP: ["Ne", "Ti", "Fe", "Si"],
  ESTJ: ["Te", "Si", "Ne", "Fi"], ESFJ: ["Fe", "Si", "Ne", "Ti"],
  ENFJ: ["Fe", "Ni", "Se", "Ti"], ENTJ: ["Te", "Ni", "Se", "Fi"],
};

/** Score the two top functions high; everything else flat. */
const profile = (dom, aux) => ({ [dom]: 10, [aux]: 8 });

test("all sixteen stacks derive from their top two functions alone", () => {
  for (const [type, ego] of Object.entries(CANONICAL)) {
    const stack = functionStack(profile(ego[0], ego[1]));
    assert.deepEqual(stack.ego, ego, `${type} ego stack`);
    assert.equal(mbtiFromStack(stack), type, `${type} letters`);
  }
});

test("the shadow is the ego with every attitude flipped", () => {
  for (const [type, ego] of Object.entries(CANONICAL)) {
    const { shadow } = functionStack(profile(ego[0], ego[1]));
    assert.equal(shadow.length, 4);
    // Together the two halves cover all eight functions exactly once.
    assert.deepEqual([...ego, ...shadow].sort(), [...FUNCTIONS].sort(), type);
  }
});

test("the auxiliary always opposes the dominant on kind and attitude", () => {
  // The constraint that makes an incoherent stack unrepresentable. Asserted
  // over every function as dominant, not just the canonical pairings.
  for (const dom of FUNCTIONS) {
    const { auxiliary } = functionStack({ [dom]: 10 });
    const kind = (f) => ("NS".includes(f[0]) ? "perceiving" : "judging");
    assert.notEqual(kind(auxiliary), kind(dom), `${dom} -> ${auxiliary} kind`);
    assert.notEqual(auxiliary[1], dom[1], `${dom} -> ${auxiliary} attitude`);
  }
});

test("J/P reports the outward-facing function, not the dominant's kind", () => {
  // The rule a four-letter tally gets wrong: INTJ leads with an introverted
  // perceiving function and still ends in J, because Te faces outward.
  assert.equal(mbtiFromStack(functionStack(profile("Ni", "Te"))), "INTJ");
  assert.equal(mbtiFromStack(functionStack(profile("Ti", "Ne"))), "INTP");
  assert.equal(mbtiFromStack(functionStack(profile("Te", "Ni"))), "ENTJ");
  assert.equal(mbtiFromStack(functionStack(profile("Ne", "Ti"))), "ENTP");
});

test("an all-zero profile still resolves to a real type", () => {
  // The #26 acceptance bar: nothing deadlocks, every axis resolves. A visitor
  // who abstains on everything must still get a coherent object out.
  const stack = functionStack({});
  assert.equal(stack.ego.length, 4);
  assert.match(mbtiFromStack(stack), /^[EI][NS][TF][JP]$/);
});

test("scoring is reproducible under ties", () => {
  const flat = Object.fromEntries(FUNCTIONS.map((f) => [f, 1]));
  const a = functionStack(flat);
  const b = functionStack({ ...flat });
  assert.deepEqual(a.ego, b.ego);
});

/* ---------- Enneagram ---------- */

test("the types are a ring: 9 and 1 are adjacent", () => {
  assert.deepEqual(wingsOf(1), [9, 2]);
  assert.deepEqual(wingsOf(9), [8, 1]);
  assert.deepEqual(wingsOf(5), [4, 6]);
});

test("core, wing and tritype come out of one pass", () => {
  const r = enneagramFrom({ 5: 9, 4: 7, 6: 3, 1: 5, 9: 2, 8: 1, 3: 4, 2: 1, 7: 2 });
  assert.equal(r.core, 5);
  assert.equal(r.wing, 4, "4 outscores 6, so 5w4");
  assert.equal(r.label, "5w4");
  assert.deepEqual(r.byCenter, { gut: 1, heart: 4, head: 5 });
  assert.deepEqual(r.tritype, [5, 4, 1], "one per centre, strongest first");
});

test("the tritype takes exactly one type from each centre", () => {
  // Even when a single centre holds the three highest scores overall.
  const r = enneagramFrom({ 5: 9, 6: 8, 7: 7, 1: 1, 2: 1, 3: 1, 4: 1, 8: 1, 9: 1 });
  assert.equal(r.tritype.length, 3);
  for (const [center, types] of Object.entries(CENTERS)) {
    const picked = r.tritype.filter((t) => types.includes(t));
    assert.equal(picked.length, 1, `exactly one from ${center}`);
  }
});

test("a wing tie resolves low, and does not throw", () => {
  const r = enneagramFrom({ 5: 9, 4: 4, 6: 4 });
  assert.equal(r.wing, 4);
  assert.equal(r.label, "5w4");
});

test("an empty enneagram profile still yields a full result", () => {
  const r = enneagramFrom({});
  assert.ok(r.core >= 1 && r.core <= 9);
  assert.equal(r.tritype.length, 3);
  assert.match(r.label, /^\dw\d$/);
});

/* ---------- assembly ---------- */

test("scoreAll reports how thin the evidence is", () => {
  const r = scoreAll({
    functions: profile("Ni", "Te"), enneagram: { 5: 3 }, answered: 9, abstained: 3,
  });
  assert.equal(r.mbti.type, "INTJ");
  assert.deepEqual(r.mbti.stack, ["Ni", "Te", "Fi", "Se"]);
  assert.equal(r.enneagram.core, 5);
  // Carried deliberately: with a dozen items the evidence is always thin, and
  // a number says so more honestly than a caveat nobody reads.
  assert.equal(r.evidence.answered, 9);
  assert.equal(r.evidence.abstained, 3);
  assert.equal(r.evidence.items, 12);
  // And contested, correctly: a single Enneagram score leaves both wings and
  // two of the three centres on zero, so those are decided by nothing at all.
  assert.equal(r.evidence.contested, true);
  assert.deepEqual(r.enneagram.ties.wing, [4, 6]);
  assert.deepEqual(Object.keys(r.enneagram.ties.centers).sort(), ["gut", "heart"]);
});

/* ---------- ties (found by the first real quiz run) ---------- */

test("a contested dominant is reported, not hidden", () => {
  // The run that prompted this: Ne 4 / Ti 4 printed ENTP, and Ti winning the
  // same tie prints INTP from identical answers. Deterministic is fine; silent
  // is not, because the result reads as though the answers decided it.
  const r = scoreAll({
    functions: { Ne: 4, Ti: 4, Se: 3, Fi: 3, Ni: 2, Te: 1, Si: 1 },
    enneagram: {}, answered: 8, abstained: 0,
  });
  assert.equal(r.mbti.type, "ENTP");
  assert.deepEqual(r.mbti.ties.dominant, ["Ne", "Ti"]);
  assert.equal(r.evidence.contested, true);
});

test("an uncontested result says so", () => {
  const r = scoreAll({
    functions: { Ni: 9, Te: 7, Fi: 3, Se: 2, Ne: 1, Ti: 1, Fe: 1, Si: 1 },
    enneagram: { 5: 9, 4: 5, 1: 3, 2: 1, 8: 1 }, answered: 12, abstained: 0,
  });
  assert.equal(r.mbti.type, "INTJ");
  assert.deepEqual(r.mbti.ties, {});
  assert.deepEqual(r.enneagram.ties, {});
  assert.equal(r.evidence.contested, false);
});

test("enneagram ties are reported per contest, not as one flag", () => {
  const r = enneagramFrom({ 2: 1, 3: 1, 5: 2, 8: 2, 9: 2 });
  assert.deepEqual(r.ties.core, [5, 8, 9]);
  assert.deepEqual(r.ties.centers.gut, [8, 9]);
  assert.deepEqual(r.ties.centers.heart, [2, 3]);
  // head is uncontested: 5 outscores 6 and 7.
  assert.equal(r.ties.centers.head, undefined);
});

test("a tie among zero-scored candidates still counts as contested", () => {
  // The worst case for honesty: nothing was answered, so everything ties and
  // the "result" is pure declaration order.
  const r = scoreAll({ functions: {}, enneagram: {}, answered: 0, abstained: 12 });
  assert.equal(r.evidence.contested, true);
  assert.equal(r.mbti.ties.dominant.length, 8);
});
