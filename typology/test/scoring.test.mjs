import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FUNCTIONS, functionStack, mbtiFromStack, enneagramFrom, wingsOf, CENTERS, scoreAll, contest,
  MAX_ITEM_WEIGHT,
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
    // Both functions need a score: an auxiliary picked from four zeroes is
    // declaration order, and is now reported as unmeasured rather than chosen.
    const aux = FUNCTIONS.find(
      (f) => ("NS".includes(f[0]) !== "NS".includes(dom[0])) && f[1] !== dom[1],
    );
    const { auxiliary } = functionStack({ [dom]: 10, [aux]: 5 });
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

test("an all-zero profile resolves to no type, and says which positions", () => {
  // This used to assert the opposite — that a visitor who abstains on
  // everything still gets a four-letter type — on the reading that #26's
  // "every axis resolves" meant "nothing is ever null". That reading was
  // wrong: a type read off eight zeroes is the FUNCTIONS array in disguise,
  // and printing it in the same shape as a real result is the manufacture.
  // Nothing deadlocks, which is what the acceptance bar actually asked for.
  const stack = functionStack({});
  assert.equal(stack.ego, null);
  assert.equal(stack.dominant, null);
  assert.equal(mbtiFromStack(stack), null);
  assert.deepEqual(stack.unmeasured, ["dominant", "auxiliary"]);
});

test("a dominant with no evidenced partner yields no type either", () => {
  // The partial case, and not a rare one: four auxiliary candidates on zero
  // happens whenever the items that would separate them were abstained. The
  // dominant is real and is reported; the type is not, because J/P reads off
  // whichever of the top two faces outward and there is no second one.
  const stack = functionStack({ Ni: 4 });
  assert.equal(stack.dominant, "Ni");
  assert.equal(stack.auxiliary, null);
  assert.equal(stack.ego, null);
  assert.equal(mbtiFromStack(stack), null);
  assert.deepEqual(stack.unmeasured, ["auxiliary"]);
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

test("an empty enneagram profile yields no core, no wing, no tritype", () => {
  const r = enneagramFrom({});
  assert.equal(r.core, null);
  assert.equal(r.wing, null);
  assert.equal(r.label, null);
  assert.deepEqual(r.tritype, []);
  assert.deepEqual(r.byCenter, { gut: null, heart: null, head: null });
  assert.deepEqual(r.unmeasured, ["core", "wing", "gut", "heart", "head"]);
});

test("a centre nothing reached is dropped from the tritype, not invented", () => {
  // Verbatim from a real run: only 1, 2, 3 and 8 scored at all, and the head
  // centre came back `5` with 5, 6 and 7 tied at zero — a third of the tritype
  // decided by CENTERS declaration order and printed like a type that won.
  // Twelve items cannot cover nine types, so this is the normal case.
  const r = enneagramFrom({ 1: 1, 2: 2, 3: 2, 8: 3 });
  assert.equal(r.byCenter.head, null);
  assert.deepEqual(r.tritype, [8, 2], "two centres reached, two entries");
  // 8 wins the core, and both its wings (7 and 9) are on zero too — the same
  // absence one step down, from the same twelve-items-nine-types shortfall.
  assert.deepEqual(r.unmeasured, ["wing", "head"]);
  assert.equal(r.ties.centers?.head, undefined, "an absence is not a tie");
  // The centres that were reached are unaffected.
  assert.equal(r.byCenter.gut, 8);
  assert.deepEqual(r.ties.centers.heart, [2, 3]);
});

test("a core with both wings on zero keeps the core and drops the wing", () => {
  const r = enneagramFrom({ 5: 3 });
  assert.equal(r.core, 5);
  assert.equal(r.wing, null);
  assert.equal(r.label, "5", "no wing to name");
  assert.deepEqual(r.unmeasured, ["wing", "gut", "heart"]);
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
  // A single Enneagram score leaves both wings and two of the three centres on
  // zero. Those are not contests that came out close — nothing reached them.
  assert.equal(r.evidence.contested, false, "no contest was actually close");
  assert.equal(r.enneagram.ties.wing, undefined);
  assert.equal(r.enneagram.ties.centers, undefined);
  assert.deepEqual(r.evidence.unmeasured, [
    "enneagram.wing", "enneagram.gut", "enneagram.heart",
  ]);
  assert.deepEqual(r.enneagram.tritype, [5], "one centre reached, one entry");
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

test("nothing answered reports as unmeasured, not as an eight-way tie", () => {
  // This test used to assert `contested: true` and an eight-way dominant tie,
  // which was the best available signal before there was a better one. It read
  // as "the answers disagreed" when the truth was "there were no answers", and
  // it left a type on screen. Unmeasured is the stronger and more accurate
  // claim, so the tie is no longer reported.
  const r = scoreAll({ functions: {}, enneagram: {}, answered: 0, abstained: 12 });
  assert.equal(r.mbti.type, null);
  assert.equal(r.enneagram.label, null);
  assert.deepEqual(r.mbti.ties, {});
  assert.equal(r.evidence.contested, false);
  assert.equal(r.evidence.fragile, true, "still maximally fragile");
  assert.deepEqual(r.evidence.unmeasured, [
    "mbti.dominant", "mbti.auxiliary",
    "enneagram.core", "enneagram.wing", "enneagram.gut", "enneagram.heart", "enneagram.head",
  ]);
});

test("a one-point lead is reported as fragile even with no tie", () => {
  // Two real runs differing in a single answer printed ENTP then INTP. The
  // second reported no ties at all — Ti led Ne by exactly 1, and items carry
  // weights of up to 2, so one different answer flips it. Ties alone missed
  // this; the margin is the signal that catches it.
  const r = scoreAll({
    functions: { Ti: 4, Ne: 3, Fi: 3, Se: 2, Ni: 2, Te: 2, Si: 1, Fe: 1 },
    enneagram: { 5: 9, 4: 4, 1: 1 }, answered: 12, abstained: 0,
  });
  assert.equal(r.mbti.type, "INTP");
  assert.deepEqual(r.mbti.ties, {}, "genuinely no tie");
  assert.equal(r.evidence.margins.dominant, 1);
  assert.equal(r.evidence.fragile, true, "a 1-point lead against weight-2 items");
});

test("a decisive result is not flagged", () => {
  const r = scoreAll({
    functions: { Ni: 12, Te: 9, Fi: 3, Se: 2, Ne: 1, Ti: 1, Fe: 1, Si: 1 },
    enneagram: { 5: 12, 4: 5, 1: 3, 8: 1, 2: 1 }, answered: 12, abstained: 0,
  });
  assert.equal(r.mbti.type, "INTJ");
  assert.equal(r.evidence.contested, false);
  assert.equal(r.evidence.fragile, false);
  assert.ok(r.evidence.margins.dominant > MAX_ITEM_WEIGHT);
});

test("a tie is the special case of a zero margin", () => {
  const r = scoreAll({
    functions: { Ne: 4, Ti: 4, Se: 3, Fi: 3 },
    enneagram: { 5: 9, 4: 4 }, answered: 12, abstained: 0,
  });
  assert.equal(r.evidence.margins.dominant, 0);
  assert.equal(r.evidence.contested, true);
  assert.equal(r.evidence.fragile, true);
});
