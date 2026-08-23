/**
 * Deterministic scoring: function scores -> Beebe stack -> MBTI letters, and
 * Enneagram scores -> core, wing, tritype.
 *
 * Pure. No DOM, no network, no model. This is where Phase 3's logic lives, so
 * it is the part that can be tested exhaustively — the harness above it only
 * has to turn answers into numbers.
 *
 * The derivation runs through the *function stack*, not a four-letter tally.
 * Tallying E/I, N/S, T/F, J/P independently is the common shortcut and it is
 * wrong in a way that matters here: it can produce letter combinations whose
 * implied stack is incoherent, and it throws away the stack itself, which is
 * the more interesting object. Deriving letters from the stack cannot produce
 * an incoherent type, and yields Beebe's eight positions for free.
 *
 * None of this makes the result valid. See FINDINGS-style honesty in #26: the
 * items and their weights were authored together, so the instrument can only
 * be checked mechanically, never for accuracy.
 */

/** The eight Jungian functions, as letter + attitude. */
export const FUNCTIONS = ["Ne", "Ni", "Se", "Si", "Te", "Ti", "Fe", "Fi"];

const LETTER = (f) => f[0];
const ATTITUDE = (f) => f[1];
const KIND = (f) => ("NS".includes(LETTER(f)) ? "perceiving" : "judging");

/** N<->S within perceiving, T<->F within judging. */
const OTHER_LETTER = { N: "S", S: "N", T: "F", F: "T" };
const FLIP = { e: "i", i: "e" };

/** The partner a stack position implies: other letter of the same kind, opposite attitude. */
const counterpart = (f) => `${OTHER_LETTER[LETTER(f)]}${FLIP[ATTITUDE(f)]}`;

/** Same function, opposite attitude — how Beebe's shadow positions are formed. */
const shadowOf = (f) => `${LETTER(f)}${FLIP[ATTITUDE(f)]}`;

/**
 * Highest score wins; ties break on the FUNCTIONS order so a run is
 * reproducible rather than dependent on object key iteration.
 */
function argmax(scores, candidates) {
  return contest(scores, candidates).winner;
}

/**
 * Who won, and who it was actually a contest against.
 *
 * A first real run made this necessary. Twelve items produced `Ne 4, Ti 4` and
 * an Enneagram three-way tie at 2 — so the reported type turned on declaration
 * order, not on any answer. Ti winning that tie would have printed INTP rather
 * than ENTP from identical input. The tie-break has to stay deterministic, but
 * a result that hides how contested it was is overstating itself.
 */
export function contest(scores, candidates) {
  let winner = null;
  let top = -Infinity;
  for (const c of candidates) {
    const v = scores[c] ?? 0;
    if (v > top) { top = v; winner = c; }
  }
  const tied = candidates.filter((c) => (scores[c] ?? 0) === top);
  return { winner, top, tied, contested: tied.length > 1 };
}

/**
 * @param {Record<string, number>} scores per-function totals
 * @returns {{ego: string[], shadow: string[], dominant: string, auxiliary: string,
 *            tertiary: string, inferior: string}}
 */
export function functionStack(scores) {
  const dominant = argmax(scores, FUNCTIONS);

  // The auxiliary balances the dominant on both counts: the other kind, and the
  // other attitude. That constraint is what stops an incoherent stack forming.
  const auxCandidates = FUNCTIONS.filter(
    (f) => KIND(f) !== KIND(dominant) && ATTITUDE(f) !== ATTITUDE(dominant),
  );
  const auxiliary = argmax(scores, auxCandidates);

  const tertiary = counterpart(auxiliary);
  const inferior = counterpart(dominant);
  const ego = [dominant, auxiliary, tertiary, inferior];

  // Only the two scored positions can be contested; tertiary and inferior are
  // derived, so they inherit whatever the top two settled.
  const ties = {};
  const domContest = contest(scores, FUNCTIONS);
  if (domContest.contested) ties.dominant = domContest.tied;
  const auxContest = contest(scores, auxCandidates);
  if (auxContest.contested) ties.auxiliary = auxContest.tied;

  return { ego, shadow: ego.map(shadowOf), dominant, auxiliary, tertiary, inferior, ties };
}

/**
 * MBTI letters read off the stack rather than tallied.
 *
 * J/P is the one people get wrong: it reports the attitude of whichever of the
 * top two functions faces outward. An extraverted judging function gives J, an
 * extraverted perceiving function gives P — which is why INTJ leads with an
 * *introverted* perceiving function and still ends in J.
 */
export function mbtiFromStack(stack) {
  const { dominant, auxiliary } = stack;
  const top = [dominant, auxiliary];

  const perceiving = top.find((f) => KIND(f) === "perceiving");
  const judging = top.find((f) => KIND(f) === "judging");
  const extraverted = top.find((f) => ATTITUDE(f) === "e");

  return [
    ATTITUDE(dominant) === "e" ? "E" : "I",
    LETTER(perceiving),
    LETTER(judging),
    KIND(extraverted) === "judging" ? "J" : "P",
  ].join("");
}

/* ---------- Enneagram ---------- */

export const CENTERS = {
  gut: [8, 9, 1],
  heart: [2, 3, 4],
  head: [5, 6, 7],
};

const ALL_TYPES = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** 9 and 1 are adjacent — the types are a ring, not a line. */
export function wingsOf(type) {
  const prev = type === 1 ? 9 : type - 1;
  const next = type === 9 ? 1 : type + 1;
  return [prev, next];
}

const topType = (scores, candidates) => contest(scores, candidates).winner;

/**
 * @param {Record<number, number>} scores per-type totals
 * @returns {{core: number, wing: number, label: string, tritype: number[],
 *            byCenter: Record<string, number>}}
 */
export function enneagramFrom(scores) {
  const core = topType(scores, ALL_TYPES);
  const [prev, next] = wingsOf(core);
  // A tie goes to the lower-numbered wing, for reproducibility rather than
  // for any theoretical reason.
  const wing = (scores[next] ?? 0) > (scores[prev] ?? 0) ? next : prev;

  const byCenter = {};
  for (const [center, types] of Object.entries(CENTERS)) {
    byCenter[center] = topType(scores, types);
  }
  // Tritype is one type per centre, conventionally written strongest first.
  const tritype = Object.values(byCenter).sort(
    (a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || a - b,
  );

  const ties = {};
  const coreContest = contest(scores, ALL_TYPES);
  if (coreContest.contested) ties.core = coreContest.tied;
  if ((scores[next] ?? 0) === (scores[prev] ?? 0)) ties.wing = [prev, next];
  for (const [center, types] of Object.entries(CENTERS)) {
    const c = contest(scores, types);
    if (c.contested) (ties.centers ??= {})[center] = c.tied;
  }

  return { core, wing, label: `${core}w${wing}`, tritype, byCenter, ties };
}

/* ---------- assembly ---------- */

/**
 * Turn accumulated weights into a result.
 *
 * `answered` is carried through so a caller can see how thin the evidence is;
 * with a dozen items it is always thin, and the number is the honest way to
 * say so rather than a caveat nobody reads.
 */
export function scoreAll({ functions = {}, enneagram = {}, answered = 0, abstained = 0 }) {
  const stack = functionStack(functions);
  const enn = enneagramFrom(enneagram);
  return {
    mbti: {
      type: mbtiFromStack(stack),
      stack: stack.ego,
      shadow: stack.shadow,
      ties: stack.ties,
      scores: functions,
    },
    enneagram: { ...enn, scores: enneagram },
    evidence: {
      answered, abstained, items: answered + abstained,
      // Surfaced next to the counts because it is the same kind of fact: how
      // much of this result the answers actually determined. A first real run
      // returned ENTP off a Ne/Ti tie — Ti winning it would have printed INTP
      // from identical answers.
      contested: Object.keys(stack.ties).length > 0 || Object.keys(enn.ties).length > 0,
    },
  };
}
