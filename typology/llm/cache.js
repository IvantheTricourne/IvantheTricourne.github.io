/**
 * What is actually on disk, and how to get rid of it.
 *
 * Phase 1 shipped a 2.3 GB download with no way to see it or remove it short
 * of DevTools, and a size figure that was really `vram_required_MB` wearing a
 * disk costume. Both are fixed here, and the fix for the second is to stop
 * guessing: the bytes are sitting in the visitor's Cache API, so measure them.
 *
 * WebLLM keeps three origin-scoped buckets. Weights dominate; the other two
 * are kilobytes.
 */
const SCOPES = ["webllm/model", "webllm/wasm", "webllm/config"];

/** Where mlc-ai publishes prebuilt weights. Ids double as repo names. */
const repoPath = (modelId) => `/mlc-ai/${modelId}/`;

const WEBLLM = "https://esm.run/@mlc-ai/web-llm@0.2.84";

/**
 * Read cache state with the raw Cache API rather than WebLLM's own helpers.
 *
 * Deliberate: importing the library to answer "is this cached?" would pull it
 * over the CDN on every page load, including for visitors who only ever use a
 * hosted key — exactly the cost models.js was split out to avoid. The price is
 * a coupling to mlc-ai's URL layout, and it is the right side of the trade
 * because a drift here is cosmetic (a model shows as uncached) rather than
 * destructive. Deletion, where correctness does matter, uses their API.
 */
export async function inspectCachedModel(modelId) {
  if (typeof caches === "undefined") return { supported: false, cached: false, bytes: 0 };
  const needle = repoPath(modelId);
  let bytes = 0;
  let entries = 0;
  let measured = true;

  try {
    for (const scope of SCOPES) {
      if (!(await caches.has(scope))) continue;
      const cache = await caches.open(scope);
      for (const request of await cache.keys()) {
        if (!request.url.includes(needle)) continue;
        entries += 1;
        const response = await cache.match(request);
        const length = Number(response?.headers?.get("content-length"));
        // Header-derived on purpose: reading each shard as a blob to get an
        // exact byte count would pull gigabytes through memory to learn
        // something a header already states.
        if (Number.isFinite(length) && length > 0) bytes += length;
        else measured = false;
      }
    }
  } catch {
    return { supported: false, cached: false, bytes: 0 };
  }

  return {
    supported: true,
    cached: entries > 0,
    entries,
    bytes,
    /** False when a shard lacked Content-Length, so `bytes` is a floor. */
    measured: measured && bytes > 0,
    megabytes: bytes ? Math.round(bytes / 1e6) : 0,
  };
}

export async function inspectAll(models) {
  const out = {};
  await Promise.all(models.map(async (m) => { out[m.id] = await inspectCachedModel(m.id); }));
  return out;
}

/**
 * Delete one model's weights, wasm, and config.
 *
 * Uses WebLLM's own helper, imported lazily. By the time this runs the visitor
 * has clicked a delete button, so the library fetch is no longer a cost
 * imposed on someone who never asked for a local model.
 */
export async function deleteModel(modelId) {
  const before = await inspectCachedModel(modelId);
  const { deleteModelAllInfoInCache } = await import(WEBLLM);
  await deleteModelAllInfoInCache(modelId);
  const after = await inspectCachedModel(modelId);
  return { freedMB: Math.max(0, before.megabytes - after.megabytes), remaining: after };
}

/** WebLLM's own view, for cross-checking ours. Costs the library import. */
export async function confirmCached(modelId) {
  const { hasModelInCache } = await import(WEBLLM);
  try { return await hasModelInCache(modelId); } catch { return false; }
}
