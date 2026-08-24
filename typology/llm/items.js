/**
 * The Phase 3 item bank. Engineer framing only.
 *
 * Twelve forced choices — eight feeding the function stack, four feeding the
 * Enneagram. That is far too few to measure anyone, and it is meant to be:
 * #26's job is to give the harness real classification work, not to build an
 * instrument. The items and their weights were authored together by one
 * person, so tuning them to produce a chosen answer would be trivial and would
 * demonstrate nothing. The only honest check is mechanical.
 *
 * Every item is a forced choice between *named poles*, which is the shape
 * `classify()` already takes — the LLM maps a free-text answer onto a pole and
 * the weights below turn that pole into numbers. Nothing here re-implements
 * classification.
 *
 * Item shape:
 *   id       stable identifier
 *   scale    "functions" | "enneagram" — which score table the weights land in
 *   axis     what the item is trying to separate, for display and for gating
 *   prompt   the question, in second person
 *   poles    [{ id, label, hint, weights }]
 *   gate     optional { scale, marginBelow } — ask only while that scale's top
 *            two are within `marginBelow` of each other
 */

/* ---------- function items ---------- */

const FUNCTION_ITEMS = [
  {
    id: "fn-open-problem",
    scale: "functions",
    axis: "Ne / Ni",
    prompt: "You are handed a vague problem with no clear spec. What is your first move?",
    poles: [
      { id: "ne", label: "Spread out", hint: "sketch several possible shapes for it before committing",
        weights: { Ne: 2 } },
      { id: "ni", label: "Drill down", hint: "sit with it until one underlying model clicks",
        weights: { Ni: 2 } },
    ],
  },
  {
    id: "fn-unfamiliar-system",
    scale: "functions",
    axis: "Se / Si",
    prompt: "You are dropped into a running system you have never seen. How do you get oriented?",
    poles: [
      { id: "se", label: "Poke it", hint: "run it, break it, watch what actually happens",
        weights: { Se: 2 } },
      { id: "si", label: "Place it", hint: "find what it resembles from systems you already know",
        weights: { Si: 2 } },
    ],
  },
  {
    id: "fn-correctness",
    scale: "functions",
    axis: "Te / Ti",
    prompt: "A change passes every test but the design still bothers you. Do you ship it?",
    poles: [
      { id: "te", label: "Ship it", hint: "the tests are the contract; unease is not evidence",
        weights: { Te: 2 } },
      { id: "ti", label: "Hold it", hint: "if the model is wrong the tests are just not exercising it yet",
        weights: { Ti: 2 } },
    ],
  },
  {
    id: "fn-disagreement",
    scale: "functions",
    axis: "Fe / Fi",
    prompt: "The team picks an approach you think is a mistake, and nobody else objects. What do you do?",
    poles: [
      { id: "fe", label: "Go with it", hint: "a team pulling together beats being individually right",
        weights: { Fe: 2 } },
      { id: "fi", label: "Say so anyway", hint: "you would not be able to sit with staying quiet",
        weights: { Fi: 2 } },
    ],
  },
  {
    id: "fn-abstraction",
    scale: "functions",
    axis: "intuition / sensing",
    prompt: "When you explain your work to someone, where do you naturally start?",
    poles: [
      { id: "abstract", label: "The shape of it", hint: "the idea first, details only if they ask",
        weights: { Ne: 1, Ni: 1 } },
      { id: "concrete", label: "A concrete case", hint: "walk through one real example end to end",
        weights: { Se: 1, Si: 1 } },
    ],
  },
  {
    id: "fn-decision-basis",
    scale: "functions",
    axis: "thinking / feeling",
    prompt: "Two options are technically close. What actually breaks the tie for you?",
    poles: [
      { id: "logic", label: "Which is sounder", hint: "the one that holds up better under analysis",
        weights: { Te: 1, Ti: 1 } },
      { id: "people", label: "Who has to live with it", hint: "the one the people involved can work with",
        weights: { Fe: 1, Fi: 1 } },
    ],
  },
  {
    id: "fn-energy",
    scale: "functions",
    axis: "extraversion / introversion",
    prompt: "You have a hard problem and a free afternoon. How do you want to spend it?",
    poles: [
      { id: "outward", label: "Talking it out", hint: "thinking happens out loud, with someone",
        weights: { Ne: 1, Se: 1, Te: 1, Fe: 1 } },
      { id: "inward", label: "Alone with it", hint: "thinking happens quietly, then you report back",
        weights: { Ni: 1, Si: 1, Ti: 1, Fi: 1 } },
    ],
  },
  {
    id: "fn-closure",
    scale: "functions",
    axis: "judging / perceiving",
    prompt: "Halfway through, a better approach occurs to you. The current one would work.",
    poles: [
      { id: "close", label: "Finish what you started", hint: "an open decision costs more than a suboptimal one",
        weights: { Te: 1, Fe: 1 } },
      { id: "open", label: "Change course", hint: "committing early to the wrong thing is the real cost",
        weights: { Ne: 1, Se: 1 } },
    ],
  },
];

/* ---------- enneagram items ---------- */

const ENNEAGRAM_ITEMS = [
  {
    id: "en-standards",
    scale: "enneagram",
    axis: "1 / 3 / 5",
    prompt: "Your work is going to be seen by people whose opinion you care about. What are you most anxious about?",
    poles: [
      { id: "one", label: "That it is not right", hint: "there is a correct version and this is not yet it",
        weights: { 1: 2 } },
      { id: "three", label: "That it does not land", hint: "it needs to be seen as good, not merely be good",
        weights: { 3: 2 } },
      { id: "five", label: "That I will be exposed", hint: "someone will ask the question you have not thought about",
        weights: { 5: 2 } },
    ],
  },
  {
    id: "en-others",
    scale: "enneagram",
    axis: "2 / 6 / 9",
    prompt: "A team you are on is quietly falling apart. What do you find yourself doing?",
    poles: [
      { id: "two", label: "Shoring people up", hint: "finding who needs help and giving it",
        weights: { 2: 2 } },
      { id: "six", label: "Naming the risk", hint: "someone has to say what is actually going wrong",
        weights: { 6: 2 } },
      { id: "nine", label: "Absorbing it", hint: "keeping the peace and hoping it settles",
        weights: { 9: 2 } },
    ],
  },
  {
    id: "en-constraint",
    scale: "enneagram",
    axis: "4 / 7 / 8",
    prompt: "You are told to do something a way you did not choose. What is the reaction under the surface?",
    poles: [
      { id: "four", label: "This is not mine", hint: "the work stops feeling like yours and starts feeling hollow",
        weights: { 4: 2 } },
      { id: "seven", label: "Find the gap", hint: "there is a more interesting way through and you go looking",
        weights: { 7: 2 } },
      { id: "eight", label: "Push back", hint: "you want to know who decided, and why they get to",
        weights: { 8: 2 } },
    ],
  },
  {
    // Gated: only asked while the top two Enneagram scores are close, which is
    // Phase 4's adaptive mechanic in its smallest honest form.
    id: "en-pressure",
    scale: "enneagram",
    axis: "tie-break under stress",
    gate: { scale: "enneagram", marginBelow: 2 },
    prompt: "Under real pressure, which failure sounds most like yours?",
    poles: [
      { id: "control", label: "Grip too hard", hint: "you take it all on rather than let it go wrong",
        weights: { 1: 1, 8: 1 } },
      { id: "perform", label: "Perform through it", hint: "you keep looking fine well past the point you are",
        weights: { 2: 1, 3: 1 } },
      { id: "withdraw", label: "Go quiet", hint: "you pull inward and stop telling anyone where you are",
        weights: { 4: 1, 5: 1, 9: 1 } },
    ],
  },
];

export const ITEMS = [...FUNCTION_ITEMS, ...ENNEAGRAM_ITEMS];

/** Items with no gate. Always asked, in order. */
export const BASE_ITEMS = ITEMS.filter((i) => !i.gate);

/** Items asked only when the scores so far leave something unresolved. */
export const GATED_ITEMS = ITEMS.filter((i) => i.gate);

/**
 * How far ahead the leader is on a scale.
 *
 * Zero when fewer than two entries have any score at all — an empty table is
 * maximally unresolved, not perfectly decided, and returning Infinity there
 * would gate away the very items meant to break the tie.
 */
export function margin(scores) {
  const values = Object.values(scores ?? {}).filter((v) => v > 0).sort((a, b) => b - a);
  if (values.length < 2) return 0;
  return values[0] - values[1];
}

/** Whether a gated item still has a question worth asking. */
export function shouldAsk(item, scoreTables) {
  if (!item.gate) return true;
  return margin(scoreTables[item.gate.scale]) < item.gate.marginBelow;
}

/**
 * Fold one answered item into the running totals.
 *
 * An abstention contributes nothing, deliberately: the Phase 2 bench showed
 * models will decline a genuine non-answer roughly six times in seven, and
 * that decline is information about the *answer*, not about the person. The
 * count is kept so the result can say how thin the evidence got.
 */
export function applyAnswer(scoreTables, item, poleId) {
  const pole = item.poles.find((p) => p.id === poleId);
  if (!pole) return false;
  const table = (scoreTables[item.scale] ??= {});
  for (const [key, weight] of Object.entries(pole.weights ?? {})) {
    table[key] = (table[key] ?? 0) + weight;
  }
  return true;
}
