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
  let best = null;
  for (const f of candidates) {
    if (best === null || (scores[f] ?? 0) > (scores[best] ?? 0)) best = f;
  }
  return best;
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

  return { ego, shadow: ego.map(shadowOf), dominant, auxiliary, tertiary, inferior };
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

function topType(scores, candidates) {
  let best = null;
  for (const t of candidates) {
    if (best === null || (scores[t] ?? 0) > (scores[best] ?? 0)) best = t;
  }
  return best;
}

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

  return { core, wing, label: `${core}w${wing}`, tritype, byCenter };
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
  return {
    mbti: {
      type: mbtiFromStack(stack),
      stack: stack.ego,
      shadow: stack.shadow,
      scores: functions,
    },
    enneagram: { ...enneagramFrom(enneagram), scores: enneagram },
    evidence: { answered, abstained, items: answered + abstained },
  };
}
