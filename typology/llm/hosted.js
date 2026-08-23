/**
 * Hosted backend: the visitor's own key, straight from their browser to the
 * provider. No key belonging to this site exists anywhere in this file, and
 * there is no proxy — a key shipped to the browser would be public, and an
 * unauthenticated relay would be drained by the first person to find it.
 *
 * The key never leaves the visitor's machine except to the provider they
 * chose. It is held in localStorage and is never sent to this origin.
 *
 * NOTE: request shapes here are written against each provider's documented
 * REST API but were not exercised against a live endpoint (no key available
 * during Phase 1, and both vendors' doc hosts are blocked from the build
 * environment). PROVIDERS is deliberately the single place to correct if a
 * model id or field name has drifted.
 */
import { ERR, LlmError, schemaFor, systemPrompt, userPrompt } from "./contract.js";
import { parseClassification } from "./json.js";

/**
 * Gemini's responseSchema is an OpenAPI subset that rejects some standard
 * JSON Schema keywords, additionalProperties among them.
 */
function toGeminiSchema(schema) {
  const { additionalProperties, ...rest } = schema;
  return {
    ...rest,
    properties: Object.fromEntries(
      Object.entries(rest.properties).map(([k, v]) => {
        const { additionalProperties: _drop, ...prop } = v;
        return [k, prop];
      }),
    ),
  };
}

export const PROVIDERS = {
  gemini: {
    label: "Google Gemini",
    defaultModel: "gemini-2.5-flash",
    keyHint: "Get a key at aistudio.google.com/apikey",
    endpoint: (model, key) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`,
    headers: () => ({ "Content-Type": "application/json" }),
    body: (item, freeText) => ({
      systemInstruction: { parts: [{ text: systemPrompt() }] },
      contents: [{ role: "user", parts: [{ text: userPrompt(item, freeText) }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 220,
        responseMimeType: "application/json",
        responseSchema: toGeminiSchema(schemaFor(item)),
      },
    }),
    delta: (chunk) => chunk?.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
  },

  groq: {
    label: "Groq",
    defaultModel: "llama-3.3-70b-versatile",
    keyHint: "Get a key at console.groq.com/keys",
    endpoint: () => "https://api.groq.com/openai/v1/chat/completions",
    headers: (key) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    }),
    body: (item, freeText, model) => ({
      model,
      stream: true,
      temperature: 0,
      max_tokens: 220,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt() },
        { role: "user", content: userPrompt(item, freeText) },
      ],
    }),
    delta: (chunk) => chunk?.choices?.[0]?.delta?.content ?? "",
  },
};

/** Pure, so the request shape is pinned by tests even without a live call. */
export function buildRequest(providerId, { item, freeText, model, key }) {
  const provider = PROVIDERS[providerId];
  if (!provider) throw new LlmError(ERR.UNSUPPORTED, `Unknown provider "${providerId}".`);
  const chosen = model || provider.defaultModel;
  return {
    url: provider.endpoint(chosen, key),
    init: {
      method: "POST",
      headers: provider.headers(key),
      body: JSON.stringify(provider.body(item, freeText, chosen)),
    },
  };
}

function mapHttpError(status, retryAfter, detail) {
  if (status === 401 || status === 403) {
    return new LlmError(ERR.BAD_KEY, "That key was rejected. Check it and try again.");
  }
  if (status === 429) {
    return new LlmError(ERR.RATE_LIMITED, "Rate limit reached on this key.", {
      retryable: true,
      retryAfter: retryAfter ? Number(retryAfter) : null,
    });
  }
  if (status >= 500) {
    return new LlmError(ERR.NETWORK, `Provider returned ${status}.`, { retryable: true });
  }
  return new LlmError(ERR.NETWORK, `Request failed (${status}). ${detail ?? ""}`.trim());
}

/** Both providers speak `data: {...}` SSE; only the delta path differs. */
async function* readSse(response, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let cut;
      while ((cut = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try { yield JSON.parse(payload); } catch { /* partial frame, skip */ }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

export function createHostedBackend({ provider = "gemini", model = "", getKey } = {}) {
  const spec = PROVIDERS[provider];
  if (!spec) throw new LlmError(ERR.UNSUPPORTED, `Unknown provider "${provider}".`);

  return {
    id: "hosted",
    label: `${spec.label} (your key)`,
    model: model || spec.defaultModel,

    async init() {
      if (!getKey?.()) {
        throw new LlmError(ERR.BAD_KEY, `No API key set. ${spec.keyHint}`);
      }
    },

    async classify(item, freeText, { onToken, signal } = {}) {
      const key = getKey?.();
      if (!key) throw new LlmError(ERR.BAD_KEY, `No API key set. ${spec.keyHint}`);

      const { url, init } = buildRequest(provider, {
        item, freeText, model: model || spec.defaultModel, key,
      });

      let response;
      try {
        response = await fetch(url, { ...init, signal });
      } catch (cause) {
        if (signal?.aborted) throw new LlmError(ERR.ABORTED, "Cancelled.", { cause });
        // A blocked CORS preflight is indistinguishable from an offline network
        // at this layer; both land here and both are worth retrying once.
        throw new LlmError(ERR.NETWORK, "Could not reach the provider.", { cause, retryable: true });
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw mapHttpError(response.status, response.headers.get("retry-after"), detail.slice(0, 200));
      }

      let text = "";
      for await (const chunk of readSse(response, signal)) {
        const delta = spec.delta(chunk);
        if (delta) { text += delta; onToken?.(delta); }
      }

      if (signal?.aborted) throw new LlmError(ERR.ABORTED, "Cancelled.");

      const parsed = parseClassification(text, item);
      if (!parsed.ok) {
        throw new LlmError(ERR.MALFORMED_OUTPUT,
          `Model output could not be read (${parsed.reason}).`, { retryable: true });
      }
      return {
        ...parsed.value, repairs: parsed.repairs,
        backend: "hosted", model: model || spec.defaultModel, raw: text,
      };
    },

    async dispose() {},
  };
}
