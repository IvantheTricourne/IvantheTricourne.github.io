/**
 * Local backend: WebLLM over WebGPU, weights from HuggingFace's CDN.
 *
 * Nothing here costs the site anything to run — no key exists, and the weights
 * are not served from this origin. The cost is borne entirely by the visitor,
 * once, as a download that the Cache API then reuses.
 */
import { CreateWebWorkerMLCEngine } from "https://esm.run/@mlc-ai/web-llm@0.2.84";
import { ERR, LlmError, schemaFor, systemPrompt, userPrompt, terseRetryNote } from "./contract.js";
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

/**
 * Output budget.
 *
 * Was 220, which held for 126 calls and then cut one off mid-object on an
 * answer naming both poles — Qwen writes a long rationale when it has to
 * reconcile a conflict. The parse cap is 400 characters, roughly 100 tokens,
 * and 220 left no room for that plus the rest of the object.
 */
const MAX_TOKENS = 512;

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

      const request = (constrained, extraUser) => ({
        stream: true,
        temperature: 0,
        max_tokens: MAX_TOKENS,
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
          { role: "user", content: userPrompt(item, freeText) + (extraUser ?? "") },
        ],
      });

      let constrained = true;

      /** One generation pass. Returns the raw text. */
      const generate = async (extraUser) => {
        let text = "";
        let stream;
        try {
          stream = await engine.chat.completions.create(request(true, extraUser));
        } catch (schemaErr) {
          // A grammar backend that rejects one of our schema keywords should
          // degrade to unconstrained JSON, not fail the call outright.
          if (signal?.aborted) throw schemaErr;
          constrained = false;
          stream = await engine.chat.completions.create(request(false, extraUser));
        }
        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta?.content ?? "";
          if (delta) { text += delta; onToken?.(delta); }
        }
        return text;
      };

      let text = "";
      let parsed;
      let retried = false;
      try {
        text = await generate();
        parsed = parseClassification(text, item, { abstain });

        // The one failure worth retrying. A truncated object means the answer
        // was fine and the rationale overran; at temperature 0 the retry has to
        // change the request or it returns the same bytes, so it asks for a
        // shorter rationale. Budget of one — a second overrun is a real
        // failure, not a hiccup.
        if (!parsed.ok && parsed.reason === "truncated-json" && !signal?.aborted) {
          retried = true;
          onToken?.("\n[cut off — retrying with a shorter rationale]\n");
          text = await generate(terseRetryNote());
          parsed = parseClassification(text, item, { abstain });
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

      if (!parsed.ok) {
        throw new LlmError(
          ERR.MALFORMED_OUTPUT,
          `Model output could not be read (${parsed.reason}).`,
          { retryable: parsed.reason !== "truncated-json" },
        );
      }
      const repairs = [...parsed.repairs];
      if (!constrained) repairs.push("schema-unconstrained");
      if (retried) repairs.push("retried-after-truncation");
      return {
        ...parsed.value,
        // Surfaced so phase 2 can separate "the grammar held" from "the repair
        // layer saved it" instead of scoring both as a pass.
        repairs,
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
