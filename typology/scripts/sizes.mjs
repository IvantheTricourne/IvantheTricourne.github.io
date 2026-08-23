/**
 * Re-read real download sizes for the model catalogue from HuggingFace.
 *
 * `vram_required_MB` from WebLLM's config is a GPU-memory figure and has run
 * to 2.07x the actual download, so it cannot gate storage. This sums the model
 * repo instead. Run it when adding a model, or when a published repo changes.
 *
 *   node scripts/sizes.mjs
 */
import { LOCAL_MODELS } from "../llm/models.js";

const API = (id) => `https://huggingface.co/api/models/mlc-ai/${id}/tree/main?recursive=true`;

for (const model of LOCAL_MODELS) {
  const response = await fetch(API(model.id));
  if (!response.ok) {
    console.error(`${model.label}: HTTP ${response.status}`);
    continue;
  }
  const files = (await response.json()).filter((f) => f.type === "file");
  const bytes = files.reduce((sum, f) => sum + (f.size ?? 0), 0);
  const mb = Math.round(bytes / 1e6);
  const drift = model.downloadMB ? `${mb === model.downloadMB ? "=" : "DRIFT"} catalogue ${model.downloadMB}` : "";
  console.log(
    `${model.label.padEnd(14)} ${String(mb).padStart(5)} MB  ${String(files.length).padStart(3)} files`
    + `  vram ${String(model.vramMB).padStart(4)} (${(model.vramMB / mb).toFixed(2)}x)  ${drift}`,
  );
}
