/**
 * Local backend: WebLLM over WebGPU, weights from HuggingFace's CDN.
 *
 * Nothing here costs the site anything to run — no key exists, and the weights
 * are not served from this origin. The cost is borne entirely by the visitor,
 * once, as a download that the Cache API then reuses.
 */
import { CreateWebWorkerMLCEngine } from "https://esm.run/@mlc-ai/web-llm@0.2.84";
import { ERR, LlmError, schemaFor, systemPrompt, userPrompt } from "./contract.js";
import { parseClassification } from "./json.js";
import { detectWebGpu } from "./capability.js";
import { LOCAL_MODELS, DEFAULT_LOCAL_MODEL } from "./models.js";

export { LOCAL_MODELS, DEFAULT_LOCAL_MODEL };

/**
 * Out of GPU memory, or out of disk?
 *
 * Phase 1 collapsed both into "Could not load X", which left a device that
 * cannot *run* a model indistinguishable from one that cannot *store* it. The
 * remedies are opposite — pick a smaller model versus free up space — so
 * reporting them identically sends people to the wrong fix. WebGPU has no
 * typed OOM error to check, so this matches on the wording the browsers use.
 */
const OOM_SIGNS =
  /out of memory|\boom\b|failed to allocate|exceeds? the .{0,24}limit|device lost|buffer size|insufficient memory|allocation failed/i;

function asLoadError(cause, model) {
  const message = cause?.message ?? "";
  if (OOM_SIGNS.test(message)) {
    return new LlmError(
      ERR.OUT_OF_MEMORY,
      `${model.label} needs about ${model.vramMB?.toLocaleString?.() ?? "?"} MB of GPU memory `
      + `and this device could not spare it. A smaller model will fit; freeing disk will not help.`,
      { cause },
    );
  }
  return new LlmError(
    ERR.MODEL_LOAD_FAILED,
    `Could not load ${model.label}. ${message}`.trim(),
    { cause },
  );
}

export function createLocalBackend({ modelId = DEFAULT_LOCAL_MODEL } = {}) {
  let engine = null;
  let worker = null;
  const model = LOCAL_MODELS.find((m) => m.id === modelId) ?? { id: modelId, label: modelId };

  return {
    id: "local",
    label: `${model.label} (in-browser)`,
    model: model.id,

    async init({ onProgress, signal } = {}) {
      const gpu = await detectWebGpu();
      if (!gpu.supported) throw new LlmError(ERR.NO_WEBGPU, gpu.reason);
      if (signal?.aborted) throw new LlmError(ERR.ABORTED, "Cancelled before load.");

      try {
        worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
        engine = await CreateWebWorkerMLCEngine(worker, model.id, {
          initProgressCallback: (report) => {
            onProgress?.({
              // WebLLM reports 0..1 across fetch + GPU upload combined.
              progress: report.progress,
              text: report.text,
            });
          },
        });
      } catch (cause) {
        // A cancelled download surfaces here as a generic failure; distinguish
        // it so the UI does not show an error for something the user asked for.
        if (signal?.aborted) throw new LlmError(ERR.ABORTED, "Cancelled during load.", { cause });
        throw asLoadError(cause, model);
      }
    },

    async classify(item, freeText, { onToken, signal, abstain = true } = {}) {
      if (!engine) throw new LlmError(ERR.MODEL_LOAD_FAILED, "Backend was not initialised.");

      const onAbort = () => engine.interruptGenerate();
      signal?.addEventListener("abort", onAbort, { once: true });

      const request = (constrained) => ({
        stream: true,
        temperature: 0,
        max_tokens: 220,
        response_format: constrained
          // xgrammar constrains decoding to this schema, so an invalid pole is
          // unrepresentable rather than merely discouraged. With abstention on,
          // that now includes a representable way to decline.
          ? { type: "json_object", schema: JSON.stringify(schemaFor(item, { abstain })) }
          // Fallback: plain JSON mode. Valid JSON, arbitrary keys — json.js
          // has to carry it from here.
          : { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt({ abstain }) },
          { role: "user", content: userPrompt(item, freeText) },
        ],
      });

      let text = "";
      let constrained = true;
      try {
        let stream;
        try {
          stream = await engine.chat.completions.create(request(true));
        } catch (schemaErr) {
          // A grammar backend that rejects one of our schema keywords should
          // degrade to unconstrained JSON, not fail the call outright.
          if (signal?.aborted) throw schemaErr;
          constrained = false;
          stream = await engine.chat.completions.create(request(false));
        }

        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta?.content ?? "";
          if (delta) { text += delta; onToken?.(delta); }
        }
      } catch (cause) {
        if (signal?.aborted) throw new LlmError(ERR.ABORTED, "Cancelled.", { cause });
        // A model can load and still exhaust VRAM once a KV cache is allocated,
        // so generation needs the same discrimination the load path got.
        throw asLoadError(cause, model);
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }

      if (signal?.aborted) throw new LlmError(ERR.ABORTED, "Cancelled.");

      const parsed = parseClassification(text, item, { abstain });
      if (!parsed.ok) {
        throw new LlmError(
          ERR.MALFORMED_OUTPUT,
          `Model output could not be read (${parsed.reason}).`,
          { retryable: true },
        );
      }
      return {
        ...parsed.value,
        // Surfaced so phase 2 can separate "the grammar held" from "the repair
        // layer saved it" instead of scoring both as a pass.
        repairs: constrained ? parsed.repairs : [...parsed.repairs, "schema-unconstrained"],
        backend: "local", model: model.id, raw: text,
      };
    },

    async dispose() {
      try { await engine?.unload?.(); } catch { /* already gone */ }
      worker?.terminate();
      engine = null;
      worker = null;
    },
  };
}
