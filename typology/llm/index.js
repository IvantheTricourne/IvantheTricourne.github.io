/**
 * Backend factory.
 *
 * Both backends are loaded lazily and on demand. That matters: importing
 * local.js eagerly would pull WebLLM over the CDN for every visitor, including
 * the ones who will only ever use a hosted key or no model at all.
 */
import { ERR, LlmError } from "./contract.js";

export { ERR, LlmError, isAbort, ABSTAIN, schemaFor, systemPrompt } from "./contract.js";
export { LOCAL_MODELS, DEFAULT_LOCAL_MODEL, sizeOf, formatSize } from "./models.js";
export { detectWebGpu, estimateStorage, downloadCaution } from "./capability.js";
export { parseClassification } from "./json.js";

export async function listProviders() {
  const { PROVIDERS } = await import("./hosted.js");
  return PROVIDERS;
}

export async function createBackend(kind, options = {}) {
  if (kind === "local") {
    const { createLocalBackend } = await import("./local.js");
    return createLocalBackend(options);
  }
  if (kind === "hosted") {
    const { createHostedBackend } = await import("./hosted.js");
    return createHostedBackend(options);
  }
  throw new LlmError(ERR.UNSUPPORTED, `Unknown backend "${kind}".`);
}
