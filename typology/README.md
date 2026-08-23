# typology

An exploration project for shipping LLM-capable webapps on a static host.
Tracking issue: [#27](https://github.com/IvantheTricourne/IvantheTricourne.github.io/issues/27).

The typology quiz (MBTI + Enneagram tritype) is the *vehicle* — it generates
real classification work for a model. It is not the goal, and it is explicitly
not intended as a rigorous instrument.

---

## Architecture

### There is a library; it just isn't in this repo

WebLLM is an npm package (`@mlc-ai/web-llm`), not a protocol. It is invisible
here because `llm/local.js` imports it straight from a CDN:

```js
import { CreateWebWorkerMLCEngine } from "https://esm.run/@mlc-ai/web-llm@0.2.84";
```

Browsers resolve ES module imports from URLs, so there is no bundler, no
`node_modules`, and no build step. `package.json` declares **zero
dependencies** and exists only to mark `llm/*.js` as ESM for `node --test`.

### What *is* protocol-ish

The de facto protocol is the **OpenAI chat-completions shape**, which WebLLM
deliberately implements:

```js
engine.chat.completions.create({ messages, stream, response_format })    // local, a function call
POST /openai/v1/chat/completions { messages, stream, response_format }   // Groq, over HTTP
```

Same shape, one local and one remote. That convergence is what makes swapping
backends nearly free. Gemini is the outlier — `contents` / `parts` /
`generationConfig` — which is why `hosted.js` carries a per-provider `body()`
adapter rather than one shared builder.

### The layers

```
this repo — ~950 lines, 0 npm deps
│
├── app.js ············ UI. Never learns which backend it holds.
└── llm/index.js ······ factory: await import(), on demand only
    │
    ├── local ─────────────────────────────────────────────────────
    │   llm/local.js
    │     └─ import "https://esm.run/@mlc-ai/web-llm@0.2.84"  ← library, fetched HERE
    │          ├─ spawns llm/worker.js  (Web Worker) → WebGPU → GPU
    │          ├─ fetches huggingface.co ················ weights, 0.9–2.3 GB
    │          └─ fetches raw.githubusercontent.com ····· compiled WebGPU kernel (.wasm)
    │
    └── hosted ────────────────────────────────────────────────────
        llm/hosted.js — no library at all
          └─ fetch() + ~30 lines of hand-rolled SSE parsing
               ├─ generativelanguage.googleapis.com
               └─ api.groq.com
```

The local path pulls from two hosts: weights from HuggingFace, and a separately
compiled WebGPU kernel from a GitHub raw URL. The `.wasm` is the architecture
compiled to shaders; the weights are the numbers it runs on.

Backends load lazily, so opening the page fetches none of this. A hosted-key
visitor never pays to download a library they will not run.

### The load-bearing abstraction

```js
classify(item, freeText, { onToken, signal }) → { pole, confidence, rationale, repairs[] }
```

`app.js` never branches on which backend it holds. Choosing one is a factory
argument.

### Two mechanisms for valid output

Not redundant — they work at different levels.

**Structural**: grammar-constrained decoding. WebLLM bundles xgrammar; given a
JSON Schema it masks logits at every token so anything that would break the
schema has zero probability. Invalid output is *unrepresentable*, not merely
discouraged. This is why `schemaFor(item)` builds a per-item enum of real pole
ids.

**Statistical**: `llm/json.js`, cleaning up whatever got through.

The structural guarantee differs sharply by backend:

| backend | structural guarantee | how hard `json.js` works |
| --- | --- | --- |
| WebLLM local | full JSON Schema via xgrammar | light |
| Gemini | `responseSchema`, an OpenAPI subset | moderate |
| Groq | `json_object` only | **heavy** |

Groq's `json_object` guarantees *parseable JSON*, not *your* schema — it may
return `{"answer": "probably the first one"}` and be fully compliant. So the
repair layer does the most work on the backend where it gets the least
structural help. Quantifying that is Phase 2 (#25).

### Why the Worker is not decoration

Prefill on a 3B model is seconds of solid GPU and CPU work. On the main thread
the page would lock — no scrolling, and no working cancel button. Off-thread
the UI stays live and `interruptGenerate()` can actually land.

---

## What happens when you open the page

1. **~20 KB of HTML/CSS/JS.** No model, no library, no off-origin request.
2. **Capability detection runs.** WebGPU adapter probe and a storage estimate.
   With no WebGPU the local option is *disabled*, not just discouraged, and the
   hosted path is auto-selected.
3. **Nothing else happens until you click.** The load button states its own
   cost — `Download 879 MB & load` — and a model larger than free storage is
   flagged and gated behind a second, knowing press.
4. **Weights land in the Cache API** — origin-scoped and evictable, not
   localStorage. `navigator.storage.persist()` is requested before a download
   to reduce eviction risk. It is a request, not a guarantee.

The cache belongs to this origin. A model downloaded on some other WebLLM site
does not carry over.

---

## Verifying Phase 1 before starting Phase 2

Phase 2 is a *measurement* project: it compares structured-output reliability
across models. It needs a working `classify()` to measure. Everything below is
what CI cannot check.

### Already green in CI

`node --test test/*.test.mjs` — 20 tests over `json.js` and both providers'
request shapes. No GPU or key required.

### Local backend — needs WebGPU and free disk

1. Open `/typology/`. Capability should read **WebGPU available** with a vendor.
2. Pick **Llama 3.2 1B** (879 MB — smallest, fastest to validate).
3. Button should read `Download 879 MB & load`. Click it.
4. Progress bar advances through fetch and GPU upload; ends at
   *Llama 3.2 1B (in-browser) ready.*
5. Enter a hedged answer — `it depends on the friend` — and press Classify.
6. Stream panel fills with JSON; Parsed shows a pole, confidence, rationale.
7. **Reload and load again.** Should be near-instant. If it re-downloads, the
   cache is not surviving and that is a finding.

Watch for `schema-unconstrained` in the Repairs row. It means xgrammar rejected
our schema and the call silently degraded to plain JSON mode. Not fatal — the
fallback did its job — but it removes the structural arm of the Phase 2
comparison on the local path, so it needs knowing about.

### Hosted backend — needs your own key

1. Switch to Hosted, choose a provider, paste a key.
2. The model field is prefilled but editable. If you get a 400/404 naming the
   model, the default has gone stale — replace it and tell me.
3. Connect, then Classify as above.

Failure modes worth distinguishing:

- `BAD_KEY` — the key was rejected.
- `RATE_LIMITED` — free tier hit; wait and retry.
- `NETWORK: Could not reach the provider` — **the important one.** This is
  indistinguishable at that layer from a blocked CORS preflight. If a provider
  refuses browser-origin requests, the whole BYO-key path needs rethinking, and
  that changes Phase 5.

### The gate

| result | Phase 2 status |
| --- | --- |
| Local works | **Go.** The local/hosted comparison Phase 2 is built around is possible. |
| Only hosted works | **Go, narrowed.** Phase 2 measures hosted only; the local question stays open. |
| Only local works | **Go, narrowed.** Note whether the blocker was CORS — that decides Phase 5. |
| Neither works | **Blocked.** Fix the harness before measuring anything. |

The minimum bar is one backend returning a valid classification from a real
model, with `repairs[]` empty on clean input and populated on messy input. That
array is Phase 2's actual instrument; if it is not meaningful, Phase 2 has
nothing to measure.

---

## Running it

```sh
npm test                          # 20 tests, no GPU or API key needed
npx http-server . -p 8123 -s      # then open http://127.0.0.1:8123/
```

## Layout

```
llm/contract.js    the interface, error taxonomy, per-item JSON schema
llm/json.js        text -> classification recovery (pure; where the logic lives)
llm/capability.js  WebGPU / storage / connection detection
llm/local.js       WebLLM backend      llm/worker.js  engine host (off main thread)
llm/hosted.js      Gemini + Groq       llm/models.js  local model catalogue
llm/index.js       lazy backend factory
```

## Known unknowns

Ranked by how likely they are to bite on first real use.

1. **Provider model ids go stale fast.** Groq retired
   `llama-3.3-70b-versatile` on 2026-08-16, mid-review of this very PR. Both
   defaults were corrected, and the hosted model field is editable precisely
   so the next retirement is a field edit rather than a redeploy.
2. **CORS on the hosted path.** Untested — no key available. Both providers
   are documented as browser-callable, but documented and true are different
   claims.
3. **xgrammar schema support.** `schemaFor()` emits `additionalProperties:
   false`, which may or may not be accepted. A fallback to unconstrained JSON
   mode exists and is reported via `schema-unconstrained`.
4. **Live local inference generally.** Never run — no GPU in the build
   environment.
