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
/**
 * Smallest first, so the cheapest option is also the most visible one.
 *
 * `downloadMB` is the summed byte count of the model's HuggingFace repo, read
 * from the HF tree API on 2026-08-23 (see `npm run sizes`). It is the number
 * to gate storage on. `vramMB` stays only for the out-of-memory message, which
 * is the one question it actually answers.
 *
 * The gap is why this field exists at all:
 *
 *   Llama 3.2 1B   705 MB on disk   879 MB VRAM   1.25x
 *   Qwen3 1.7B     984 MB on disk  2037 MB VRAM   2.07x
 *   Llama 3.2 3B  1817 MB on disk  2264 MB VRAM   1.25x
 *
 * Not a constant ratio, so there was never a factor to correct by — Qwen3 in
 * particular reports more than double its download. Verified against a real
 * cache: the 22 `params_shard_*.bin` files for Llama 3.2 1B sum to 695.2 MB,
 * matching the 695 MB floor the Cache API measured on a machine that had it.
 */
export const LOCAL_MODELS = [
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", label: "Llama 3.2 1B", downloadMB: 705,  vramMB: 879 },
  { id: "Qwen3-1.7B-q4f16_1-MLC",            label: "Qwen3 1.7B",   downloadMB: 984,  vramMB: 2037 },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "Llama 3.2 3B", downloadMB: 1817, vramMB: 2264 },
];

/**
 * Qwen3 1.7B, on measured results rather than on size.
 *
 * The #25 bench, 19 inputs x 2 contracts x 3 models:
 *
 *                  abstain   control    non-answers (abstain)
 *   Llama 3.2 1B       27%       27%    0/7
 *   Qwen3 1.7B         87%       53%    6/7
 *   Llama 3.2 3B       80%       47%    6/7
 *
 * Qwen3 is both the most accurate and not the largest — it beats the 3B at
 * roughly half the download. Llama 3.2 1B is kept as an option but cannot be
 * the default: at 27% it is not classifying, it is completing a JSON shape.
 * On `clean-impose` its rationale reads "I reformat it to my settings straight
 * away" while its pole says `match`, and 16 of its 38 rationales are verbatim
 * echoes of the input.
 *
 * This costs 279 MB over the smallest option. A cheaper download of a model
 * that does not work is not the cheaper choice.
 */
export const DEFAULT_LOCAL_MODEL = "Qwen3-1.7B-q4f16_1-MLC";

/**
 * Best available size for a model, and how much to trust it.
 *
 * @param {object} model     an entry from LOCAL_MODELS
 * @param {object} [cached]  the result of cache.js `inspectCachedModel`
 */
export function sizeOf(model, cached) {
  if (cached?.megabytes > 0) {
    // A floor from real bytes beats a GPU figure that measured 2.08x the disk
    // it was standing in for. Requiring every shard to carry Content-Length
    // before trusting any of them threw away the good number and quietly
    // reported the bad one as "measured" — on the same screen as the floor.
    return {
      megabytes: cached.megabytes,
      source: cached.measured ? "measured" : "floor",
    };
  }
  if (model?.downloadMB) return { megabytes: model.downloadMB, source: "catalogue" };
  // Only for a model added without a verified size. The VRAM figure has run to
  // 2.07x actual disk, so anything resting on it is flagged as unreliable.
  return { megabytes: model?.vramMB ?? 0, source: "estimated" };
}

/** How to write a size without overclaiming what is known about it. */
export function formatSize(size) {
  const mb = `${size.megabytes.toLocaleString()} MB`;
  if (size.source === "floor") return `${mb}+`;
  if (size.source === "estimated") return `~${mb}`;
  return mb; // measured, or a verified catalogue figure
}

/** Whether a shortfall against this size is worth blocking a click over. */
export function isReliable(size) {
  return size.source !== "estimated";
}
