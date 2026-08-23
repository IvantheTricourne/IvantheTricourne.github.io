/**
 * Pure text -> classification recovery.
 *
 * Small quantized models emit JSON that is *nearly* right far more often than
 * they emit JSON that is right: fenced in markdown, prefaced with "Sure!",
 * confidence as "high" or as 87 instead of 0.87, the pole given as the human
 * label rather than the id. Each coercion below is recorded in `repairs` so
 * Phase 2 (#25) can measure which ones actually carry the load per model,
 * rather than guessing at where the fragility lives.
 *
 * One import (the abstain sentinel), no DOM, no network. This is the part of
 * the harness testable without a GPU or an API key, so the logic lives here.
 */

import { ABSTAIN } from "./contract.js";

const clamp01 = (n) => Math.min(1, Math.max(0, n));

/**
 * Rationale length cap. Was 240, which clipped 6 of Qwen3 1.7B's 19 abstain
 * rationales — it explains a refusal at length, so the cap was truncating the
 * explanation rather than trimming a runaway. Still inside the token budget.
 */
const RATIONALE_MAX = 400;

/** Words models reach for when asked for a number. */
const WORD_CONFIDENCE = {
  certain: 0.95, definite: 0.95, "very high": 0.9,
  high: 0.85, strong: 0.85, confident: 0.85,
  likely: 0.7, probable: 0.7, moderate: 0.6, medium: 0.6,
  mixed: 0.5, unclear: 0.4, low: 0.35, weak: 0.3,
  unsure: 0.25, uncertain: 0.25, guess: 0.2, "very low": 0.15,
};

/**
 * First balanced {...} in the text, tracking string state so braces inside
 * string values do not end the scan. Returns null when the object never
 * closes, which is the signature of a response truncated by max_tokens.
 */
export function extractJsonObject(text) {
  return findJsonObject(text).slice;
}

/**
 * Same scan, but says *why* it failed.
 *
 * "No JSON here" and "the JSON stopped halfway" have opposite remedies — the
 * first means the model ignored the format, the second means it ran out of
 * token budget mid-sentence — and collapsing them sent the first real
 * occurrence looking in the wrong place. Under grammar-constrained decoding
 * the first is nearly impossible, which is itself the clue.
 */
export function findJsonObject(text) {
  if (typeof text !== "string") return { slice: null, reason: "absent" };
  const start = text.indexOf("{");
  if (start === -1) return { slice: null, reason: "absent" };

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      return { slice: text.slice(start, i + 1), reason: "ok" };
    }
  }
  // An opening brace that never closes: the response was cut off.
  return { slice: null, reason: "unterminated" };
}

/**
 * Conservative on purpose: trailing commas only. Aggressive rewriting (quote
 * swapping, key repair) can silently change what the model meant, and a
 * corrupted-but-parseable answer is worse than a clean failure we can count.
 */
function relaxJson(source) {
  return source.replace(/,\s*([}\]])/g, "$1");
}

export function coerceConfidence(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clamp01(value > 1 ? value / 100 : value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase().replace(/%$/, "");
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return clamp01(numeric > 1 ? numeric / 100 : numeric);
    }
    if (trimmed in WORD_CONFIDENCE) return WORD_CONFIDENCE[trimmed];
  }
  return null;
}

/**
 * Resolve whatever the model said into a real pole id.
 *
 * Ambiguity is refused rather than guessed: if a sentence mentions two poles
 * we cannot tell which one was chosen, and picking arbitrarily would produce a
 * confident wrong answer, which is the one failure mode worth avoiding.
 */
export function coercePole(value, poles = []) {
  if (typeof value !== "string" || !poles.length) return null;
  const needle = value.trim().toLowerCase();
  if (!needle) return null;

  for (const p of poles) if (p.id.toLowerCase() === needle) return p.id;
  for (const p of poles) if ((p.label ?? "").toLowerCase() === needle) return p.id;

  const mentioned = poles.filter((p) => {
    const label = (p.label ?? "").toLowerCase();
    return needle.includes(p.id.toLowerCase())
      || (label.length > 2 && needle.includes(label));
  });
  return mentioned.length === 1 ? mentioned[0].id : null;
}

/**
 * Words models reach for to refuse when the contract offers them no way to.
 *
 * Used in two directions. When abstention is offered, a refusal phrased in the
 * model's own vocabulary is mapped onto the sentinel — safe, because the worst
 * case converts a malformed response into an abstention, which is the
 * conservative direction and cannot manufacture a false pole. When abstention
 * is *not* offered, the same match is recorded as a distinct failure reason,
 * so #25 can count how often a model tries to refuse anyway.
 */
const REFUSAL_HINTS = [
  "insufficient", "indeterminate", "undetermined", "unknown", "unclear",
  "no answer", "not enough", "cannot determine", "can't determine",
  "none", "n/a", "null", "unanswerable",
];

function looksLikeRefusal(value) {
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return v ? REFUSAL_HINTS.some((h) => v === h || v.includes(h)) : false;
}

/**
 * @param {string} rawText
 * @param {{poles: {id: string, label?: string}[]}} item
 * @param {{abstain?: boolean}} [options] `abstain: false` reproduces the
 *        Phase 1 contract, which is the control arm for #25.
 * @returns {{ok: true, value: object, repairs: string[]}
 *          |{ok: false, reason: string, repairs: string[]}}
 */
export function parseClassification(rawText, item, { abstain = true } = {}) {
  const repairs = [];
  const poles = item?.poles ?? [];
  // The sentinel resolves through the same path as a real pole, so every
  // coercion below applies to it too rather than needing a parallel branch.
  const resolvable = abstain ? [...poles, { id: ABSTAIN, label: ABSTAIN }] : poles;

  const found = findJsonObject(rawText);
  const slice = found.slice;
  if (!slice) {
    return {
      ok: false,
      reason: found.reason === "unterminated" ? "truncated-json" : "no-json-object",
      repairs,
    };
  }
  if (slice.trim() !== String(rawText ?? "").trim()) {
    repairs.push("extracted-from-prose");
  }

  let parsed;
  try {
    parsed = JSON.parse(slice);
  } catch {
    try {
      parsed = JSON.parse(relaxJson(slice));
      repairs.push("relaxed-trailing-comma");
    } catch {
      return { ok: false, reason: "unparseable", repairs };
    }
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "not-an-object", repairs };
  }

  const rawPole = parsed.pole ?? parsed.choice ?? parsed.answer;
  let pole = coercePole(rawPole, resolvable);
  if (!pole) {
    if (!looksLikeRefusal(rawPole)) {
      return { ok: false, reason: "unresolvable-pole", repairs };
    }
    if (!abstain) {
      // Not a parse failure in any interesting sense: the model understood the
      // task and declined, and the Phase 1 contract had no slot for that.
      return { ok: false, reason: "refused-without-abstain", repairs };
    }
    pole = ABSTAIN;
    repairs.push("coerced-abstain");
  }
  if (rawPole !== pole && !repairs.includes("coerced-abstain")) repairs.push("coerced-pole");
  if (parsed.pole === undefined) repairs.push("aliased-pole-key");

  let confidence = coerceConfidence(parsed.confidence);
  if (confidence === null) {
    confidence = 0.5;
    repairs.push("defaulted-confidence");
  } else if (typeof parsed.confidence !== "number" || parsed.confidence > 1) {
    repairs.push("coerced-confidence");
  }

  let rationale = typeof parsed.rationale === "string" ? parsed.rationale.trim() : "";
  if (!rationale) {
    rationale = "";
    repairs.push("missing-rationale");
  } else if (rationale.length > RATIONALE_MAX) {
    rationale = `${rationale.slice(0, RATIONALE_MAX - 3)}...`;
    repairs.push("truncated-rationale");
  }

  return {
    ok: true,
    value: { pole, abstained: pole === ABSTAIN, confidence, rationale },
    repairs,
  };
}
