/**
 * The one interface every backend implements.
 *
 * Phase 1 deliberately keeps this free of quiz vocabulary. An "item" is any
 * forced choice between named poles; the harness is exercised with a throwaway
 * task so the interface answers to the plumbing rather than to domain content.
 * Typology items arrive in Phase 3 (#26).
 *
 *   item  = { id, prompt, poles: [{ id, label, hint? }] }
 *   result= { pole, confidence, rationale, repairs[], backend, model }
 *
 * A backend is:
 *   { id, label, init({onProgress, signal}), classify(item, text, opts), dispose() }
 */

export const ERR = {
  NO_WEBGPU: "NO_WEBGPU",
  MODEL_LOAD_FAILED: "MODEL_LOAD_FAILED",
  ABORTED: "ABORTED",
  BAD_KEY: "BAD_KEY",
  RATE_LIMITED: "RATE_LIMITED",
  MALFORMED_OUTPUT: "MALFORMED_OUTPUT",
  NETWORK: "NETWORK",
  UNSUPPORTED: "UNSUPPORTED",
};

/** Every failure the harness can produce arrives as one of these. */
export class LlmError extends Error {
  constructor(code, message, options = {}) {
    super(message, { cause: options.cause });
    this.name = "LlmError";
    this.code = code;
    /** Whether a caller may sensibly retry the identical request. */
    this.retryable = options.retryable ?? false;
    /** Seconds to wait, when the provider told us. */
    this.retryAfter = options.retryAfter ?? null;
  }
}

export function isAbort(err) {
  return err?.code === ERR.ABORTED || err?.name === "AbortError";
}

/**
 * JSON Schema for one item's answer. The `pole` enum is built per item so a
 * constrained decoder cannot emit a pole that does not exist — which is the
 * whole reason to prefer grammar-constrained output over prompt-and-hope.
 */
export function schemaFor(item) {
  return {
    type: "object",
    properties: {
      pole: { type: "string", enum: item.poles.map((p) => p.id) },
      confidence: { type: "number" },
      rationale: { type: "string" },
    },
    required: ["pole", "confidence", "rationale"],
    additionalProperties: false,
  };
}

export function systemPrompt() {
  return [
    "You map a person's free-text answer onto one of a fixed set of poles.",
    "Reply with a single JSON object and nothing else.",
    'Keys: "pole" (exactly one of the given pole ids), "confidence"',
    '(a number from 0 to 1), "rationale" (one short sentence, max 20 words).',
    "",
    "If the answer is hedged or conditional, choose the pole matching the",
    "person's default or baseline behaviour and lower the confidence.",
    "If the answer is genuinely off-topic or empty, pick the closest pole and",
    "set confidence below 0.2 — never invent a pole that was not offered.",
  ].join("\n");
}

export function userPrompt(item, freeText) {
  const poles = item.poles
    .map((p) => `  - ${p.id}: ${p.label}${p.hint ? ` (${p.hint})` : ""}`)
    .join("\n");
  return [
    `Question: ${item.prompt}`,
    "",
    "Poles:",
    poles,
    "",
    `Their answer: ${JSON.stringify(freeText ?? "")}`,
  ].join("\n");
}
