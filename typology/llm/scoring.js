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
 *
 * `evidenced` is the harder version of the same problem. A contest whose top
 * score is zero is not close — it is empty, and its "winner" is whichever
 * candidate happens to be declared first. A later run made that concrete: the
 * head centre came back `5` with 5, 6 and 7 all on zero, printed in the same
 * shape as a type that had won something. Callers must not present an
 * unevidenced winner as a result.
 */
export function contest(scores, candidates) {
  let winner = null;
  let top = -Infinity;
  for (const c of candidates) {
    const v = scores[c] ?? 0;
    if (v > top) { top = v; winner = c; }
  }
  const tied = candidates.filter((c) => (scores[c] ?? 0) === top);
  const runnerUp = candidates
    .filter((c) => c !== winner)
    .reduce((best, c) => Math.max(best, scores[c] ?? 0), 0);
  const evidenced = top > 0;
  return {
    winner, top, tied, evidenced,
    // A tie among candidates that all scored zero is an absence, not a
    // contest. Reporting it as contested buries the stronger fact.
    contested: tied.length > 1 && evidenced,
    margin: top - runnerUp,
  };
}

/**
 * @param {Record<string, number>} scores per-function totals
 * @returns {{ego: string[], shadow: string[], dominant: string, auxiliary: string,
 *            tertiary: string, inferior: string}}
 */
export function functionStack(scores) {
  const domContest = contest(scores, FUNCTIONS);
  const ties = {};
  const unmeasured = [];

  // Nothing scored at all — every visitor answer abstained, or none arrived.
  // The whole stack would be declaration order, so there is no stack.
  if (!domContest.evidenced) {
    return {
      ego: null, shadow: null,
      dominant: null, auxiliary: null, tertiary: null, inferior: null,
      ties, unmeasured: ["dominant", "auxiliary"], margin: domContest.margin,
    };
  }

  const dominant = domContest.winner;
  if (domContest.contested) ties.dominant = domContest.tied;

  // The auxiliary balances the dominant on both counts: the other kind, and the
  // other attitude. That constraint is what stops an incoherent stack forming.
  const auxCandidates = FUNCTIONS.filter(
    (f) => KIND(f) !== KIND(dominant) && ATTITUDE(f) !== ATTITUDE(dominant),
  );
  const auxContest = contest(scores, auxCandidates);

  // A dominant with no evidenced partner is the partial case, and it is not
  // rare: four candidates on zero happens whenever the items that would have
  // separated them were abstained. Tertiary and inferior are derived from the
  // auxiliary, so they fall with it, and so does the type — J/P reads off
  // whichever of the top two faces outward, and there is no second one.
  if (!auxContest.evidenced) {
    return {
      ego: null, shadow: null,
      dominant, auxiliary: null, tertiary: null, inferior: null,
      ties, unmeasured: ["auxiliary"], margin: domContest.margin,
    };
  }

  const auxiliary = auxContest.winner;
  if (auxContest.contested) ties.auxiliary = auxContest.tied;

  const tertiary = counterpart(auxiliary);
  const inferior = counterpart(dominant);
  const ego = [dominant, auxiliary, tertiary, inferior];

  return {
    ego, shadow: ego.map(shadowOf), dominant, auxiliary, tertiary, inferior, ties,
    unmeasured, margin: domContest.margin,
  };
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
  // All four letters read off the top two. Without both, there is no honest
  // partial answer — a letter derived from an unevidenced function is the
  // manufacture this exists to prevent.
  if (!dominant || !auxiliary) return null;
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
  const coreContest = contest(scores, ALL_TYPES);
  const ties = {};
  const unmeasured = [];

  const core = coreContest.evidenced ? coreContest.winner : null;
  if (coreContest.contested) ties.core = coreContest.tied;
  if (!core) unmeasured.push("core");

  // Wings are read off the ring either side of the core, so an unmeasured core
  // has no wing to read. Two wings on zero is the same absence one step down.
  let wing = null;
  if (core) {
    const [prev, next] = wingsOf(core);
    const prevScore = scores[prev] ?? 0;
    const nextScore = scores[next] ?? 0;
    if (prevScore > 0 || nextScore > 0) {
      // A tie goes to the lower-numbered wing, for reproducibility rather than
      // for any theoretical reason.
      wing = nextScore > prevScore ? next : prev;
      if (nextScore === prevScore) ties.wing = [prev, next];
    }
  }
  if (!wing) unmeasured.push("wing");

  // One type per centre — but only from centres the answers actually reached.
  //
  // A real run returned `head: 5` with 5, 6 and 7 all on zero. Twelve items do
  // not cover nine types, so a whole centre going unscored is the normal case
  // rather than an edge one, and emitting its first-declared type as a result
  // manufactured a third of every tritype.
  const byCenter = {};
  for (const [center, types] of Object.entries(CENTERS)) {
    const c = contest(scores, types);
    byCenter[center] = c.evidenced ? c.winner : null;
    if (!c.evidenced) unmeasured.push(center);
    if (c.contested) (ties.centers ??= {})[center] = c.tied;
  }

  // Conventionally written strongest first. Shorter than three when a centre
  // went unmeasured, which is the point.
  const tritype = Object.values(byCenter)
    .filter((t) => t !== null)
    .sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || a - b);

  return {
    core, wing,
    label: core ? (wing ? `${core}w${wing}` : `${core}`) : null,
    tritype, byCenter, ties, unmeasured,
    margin: coreContest.margin,
  };
}

/* ---------- assembly ---------- */

/**
 * The largest weight any single item can contribute.
 *
 * A lead smaller than this means one different answer would have changed the
 * result — which is not the same as a tie, and is the failure mode ties alone
 * missed. Two real runs differing in one item printed ENTP and then INTP; the
 * second reported no ties at all, because Ti led Ne by exactly 1.
 */
export const MAX_ITEM_WEIGHT = 2;

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
  // Dotted so one field answers "what did the answers fail to reach", without
  // a caller having to walk both halves of the result to find out.
  const unmeasured = [
    ...stack.unmeasured.map((k) => `mbti.${k}`),
    ...enn.unmeasured.map((k) => `enneagram.${k}`),
  ];

  return {
    mbti: {
      type: mbtiFromStack(stack),
      stack: stack.ego,
      shadow: stack.shadow,
      ties: stack.ties,
      unmeasured: stack.unmeasured,
      scores: functions,
    },
    enneagram: { ...enn, scores: enneagram },
    evidence: {
      answered, abstained, items: answered + abstained,
      // Surfaced next to the counts because it is the same kind of fact: how
      // much of this result the answers actually determined.
      contested: Object.keys(stack.ties).length > 0 || Object.keys(enn.ties).length > 0,
      // Louder than `contested`, and a different claim: contested means the
      // answers disagreed, unmeasured means they never arrived. A centre or a
      // stack position listed here has no result, and the fields it would have
      // filled are null rather than a plausible-looking type.
      unmeasured,
      margins: { dominant: stack.margin, core: enn.margin },
      // The stronger signal. A tie is the special case where the margin is 0;
      // a margin of 1 against item weights of 2 is just as fragile and reports
      // no tie at all, which is exactly how a one-answer flip slipped through.
      fragile: stack.margin <= MAX_ITEM_WEIGHT || enn.margin <= MAX_ITEM_WEIGHT,
    },
  };
}
