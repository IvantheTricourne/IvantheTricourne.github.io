/**
 * Local model catalogue.
 *
 * `vramMB` is `vram_required_MB`, copied from WebLLM's own prebuiltAppConfig.
 * It is a GPU-memory figure and nothing else. Phase 1 called this field
 * `megabytes` and spent it as a disk-space number, which was wrong twice over:
 * it gated a storage decision on a memory measurement, and it reported a
 * shortfall in a unit the visitor could not act on.
 *
 * The two are related but not equal — VRAM covers weights plus KV cache plus
 * activations, disk covers weights plus a little config — so VRAM runs larger.
 * That makes it a *conservative* stand-in for a storage gate: it over-reserves,
 * refusing some downloads that would in fact have fit. Erring that way is
 * right for a gate, but it is an estimate and is labelled as one. The real
 * number is measured from the Cache API after a download (see cache.js) and
 * takes over from the estimate once it exists.
 *
 * Kept separate from local.js so the picker can render these without importing
 * WebLLM itself — a hosted-path visitor should never pay to fetch that library.
 */
/** Smallest first, so the cheapest option is also the most visible one. */
export const LOCAL_MODELS = [
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", label: "Llama 3.2 1B", vramMB: 879 },
  { id: "Qwen3-1.7B-q4f16_1-MLC",            label: "Qwen3 1.7B",   vramMB: 2037 },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "Llama 3.2 3B", vramMB: 2264 },
];

/**
 * The smallest model is the wrong default for quality and the right one for a
 * first run. Phase 1 defaulted to the largest, and on the first machine that
 * ever tried it that model did not fit in the browser's storage quota at all —
 * a default nobody can load is not a default.
 */
export const DEFAULT_LOCAL_MODEL = LOCAL_MODELS[0].id;

/**
 * Best available size for a model, and how much to trust it.
 *
 * @param {object} model     an entry from LOCAL_MODELS
 * @param {object} [cached]  the result of cache.js `inspectCachedModel`
 */
export function sizeOf(model, cached) {
  if (cached?.measured && cached.megabytes > 0) {
    return { megabytes: cached.megabytes, source: "measured" };
  }
  return { megabytes: model.vramMB, source: "estimated" };
}
