/**
 * Local model catalogue. Sizes are vram_required_MB copied from WebLLM's own
 * prebuiltAppConfig, not estimates.
 *
 * Kept separate from local.js so the picker can render these without importing
 * WebLLM itself — a hosted-path visitor should never pay to fetch that library.
 */
export const LOCAL_MODELS = [
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "Llama 3.2 3B", megabytes: 2264 },
  { id: "Qwen3-1.7B-q4f16_1-MLC",            label: "Qwen3 1.7B",   megabytes: 2037 },
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", label: "Llama 3.2 1B", megabytes: 879 },
];

export const DEFAULT_LOCAL_MODEL = LOCAL_MODELS[0].id;
