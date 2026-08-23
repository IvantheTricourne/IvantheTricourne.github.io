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

### The abstain path, and why Phase 1 needed one

Grammar-constrained decoding guarantees *shape*. It cannot guarantee
*grounding*, and Phase 1 shipped a version where that gap actively destroyed
information.

`schemaFor()` built a two-member enum with `pole` required. There was no
representable way to say "this answer does not resolve this item". The system
prompt then went further and *instructed* the model to fabricate one:

> If the answer is genuinely off-topic or empty, pick the closest pole and set
> confidence below 0.2

Given an empty answer, Qwen3 1.7B correctly detected the absence, wrote *"The
answer is empty, so it should be assigned to the closest pole"* — a near
paraphrase of that instruction — and emitted `match` at exactly 0.2. It was
obedient, not confused. Llama 3.2 1B, handed a meta-question about the UI,
ignored the confidence instruction entirely and invented an indentation
opinion the person had never expressed, at 0.50.

Two different failures with one root: a model that perceives a non-answer has
nowhere to put that perception, so it launders it into a well-formed
classification. Downstream, that is indistinguishable from a real one.

Phase 2 adds `ABSTAIN` (`"insufficient"`) to the enum and rewrites the prompt
to forbid inferring an answer from the question itself. `schemaFor(item,
{ abstain: false })` reproduces the Phase 1 contract exactly, prompt included,
because the cost of offering the option — models reaching for it on answers
they should have classified — is only measurable against the schema that lacks
it. That comparison is what `bench.html` runs.

`json.js` also maps a refusal phrased in the model's own vocabulary
(`"unknown"`, `"N/A"`, `"cannot determine"`) onto the sentinel, recording
`coerced-abstain`. Safe in the one direction that matters: the worst case turns
a malformed response into an abstention, which cannot manufacture a pole the
person never chose. Under the control contract the same match is recorded as
`refused-without-abstain` — a model trying to decline when the contract gives
it no way to.

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
5. **Anything on disk can be deleted from the page.** Phase 1 offered a
   multi-gigabyte download and no corresponding delete, which left "pick a
   smaller model" as advice nobody could act on once the larger one already
   occupied the quota — the only way out was DevTools. Cached models now list
   their measured size with a delete button, and the quota is re-read after
   every change rather than once at page load.

The cache belongs to this origin. A model downloaded on some other WebLLM site
does not carry over.

---

## Phase 2: the measurement suite

Phase 1 is merged, deployed, and smoke-tested on real hardware (WebGPU, two
models, cache persistence, warm reload, streaming, parse). Findings are on
[#25](https://github.com/IvantheTricourne/IvantheTricourne.github.io/issues/25).

`bench.html` is the instrument. 19 inputs across four categories, scored
against stated expectations, with three methodology decisions baked in:

**Wide, not deep.** Generation runs at `temperature: 0`. Two runs of the same
input on Qwen3 1.7B came back byte-identical, down to the wording of the
rationale. A repeated case is therefore one data point, not two — only breadth
of distinct awkward inputs buys information. Measuring variance would need a
separate `temperature > 0` run and should be reported as its own number.

**First run discarded.** The same model measured 4,871 ms cold and 1,018 ms
warm on identical input. That 4.8x is compile and prefill; folding it into the
first case would report it as throughput.

**Some cases are not scored.** Four inputs have no defensible single answer
("Sometimes one, sometimes the other"). They are recorded and reported as
`soft` but never counted, because scoring them would encode a preference that
has not been justified.

The four categories:

| category | n | what a pass means |
| --- | --- | --- |
| `clean` | 4 | the right pole. A model failing these fails at the task. |
| `hedged` | 4 | the right pole *and* confidence below the stated cap |
| `non-answer` | 7 | declines. Includes the verbatim input that broke Phase 1. |
| `adversarial` | 4 | classifies content, does not follow injected instructions |

Run it against both contract arms ("Both, back to back") to get the comparison
#25 actually needs: same model, same inputs, one contract change between them.
Export the raw rows from section 4 — the findings summary is meant to be
written from data, not recollection.

### What would change the plan

- **`schema-unconstrained` in repairs** — xgrammar rejected the schema and fell
  back to plain JSON mode. Did not happen on Llama 3.2 1B or Qwen3 1.7B, so
  constrained decoding is genuinely in force on both.
- **`negotiate` appearing as a pole** on `injection-invent-pole` — the grammar
  is not actually constraining, whatever the absence of the repair tag says.
- **High abstention on `clean` cases** — the option is too cheap to reach for,
  and the prompt needs to raise the bar rather than the schema lowering it.
- **`NETWORK: Could not reach the provider`** on a hosted run — indistinguishable
  from a blocked CORS preflight at that layer. If providers refuse browser
  origins, Phase 5 is not a feature, it is a proxy, and the constraints forbid
  one.

## Running it

```sh
npm test                          # 45 tests, no GPU or API key needed
npx http-server . -p 8123 -s      # harness at /, measurement suite at /bench.html
```

## Layout

```
llm/contract.js    the interface, error taxonomy, per-item schema, ABSTAIN
llm/json.js        text -> classification recovery (pure; where the logic lives)
llm/bench.js       the measurement set and its scoring rules (pure)
llm/cache.js       what is on disk, and how to delete it
llm/capability.js  WebGPU / storage / connection detection
llm/local.js       WebLLM backend      llm/worker.js  engine host (off main thread)
llm/hosted.js      Gemini + Groq       llm/models.js  local model catalogue
llm/index.js       lazy backend factory

index.html app.js         the harness
bench.html bench-app.js   the measurement runner
```

## Known unknowns

Ranked by how likely they are to bite. Struck items were resolved by the
Phase 1 smoke test on real hardware.

1. **CORS on the hosted path.** Still untested — no key available in the build
   environment, and both provider doc hosts are blocked from it. Both are
   documented as browser-callable; documented and true are different claims.
   This is the one that decides whether Phase 5 exists.
2. **Storage quota, not WebGPU, is the binding constraint.** The first machine
   to run this reported ~2.3 GB of total origin quota — enough for Qwen3 1.7B
   only after deleting the 1B, and not enough for the 3B that Phase 1 shipped
   as its default. A browser can support WebGPU perfectly and still refuse the
   download. How common that is needs data beyond one machine.
3. **Disk sizes are still estimates until something is downloaded.** The
   catalogue carries `vramMB`, a GPU-memory figure. It runs larger than disk,
   so the gate over-reserves and may refuse a download that would have fit.
   `cache.js` measures the real number from the Cache API after the first
   download and it takes over from there — but the *first* decision is always
   made on the estimate.
4. **Over-abstention.** Offering `insufficient` may make it cheap enough that
   models reach for it on answers they should have classified. This is exactly
   what the control arm measures, and it is the reason the Phase 1 contract is
   preserved verbatim rather than cleaned up.
5. **Whether a local model can *write* questions, not just classify answers.**
   Generation is open-ended where classification is constrained. Phase 4
   depends on the answer and has no issue until there is one.
6. ~~**Provider model ids go stale fast.**~~ Still true — Groq retired
   `llama-3.3-70b-versatile` mid-review of the Phase 1 PR — but the hosted
   model field is editable, so the next retirement is a field edit.
7. ~~**xgrammar schema support.**~~ Resolved: accepted on both Llama 3.2 1B and
   Qwen3 1.7B, with no `schema-unconstrained` repair on either. The fallback
   remains for backends that reject a keyword.
8. ~~**Live local inference generally.**~~ Resolved: works. ~1s steady state
   for Qwen3 1.7B after a 4.8x warmup penalty on the first run.
