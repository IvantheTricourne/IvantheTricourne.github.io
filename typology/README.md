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

## Phase 3: the quiz

`quiz.html` runs twelve forced-choice items through `classify()` and scores the
result deterministically. Engineer framing only.

**It is not a validated instrument, and cannot be.** The items and their
weights were written together by one person, so tuning them to produce any
chosen answer would be trivial and would demonstrate nothing about accuracy.
The only claim being made is mechanical: the pipeline completes, every axis
resolves, the tritype takes one type per centre, and nothing deadlocks. That is
also all #26 asked for.

### The split that matters

The model's only job is mapping a free-text answer onto one of an item's named
poles. Weights, stack derivation and tritype are pure arithmetic in
`llm/scoring.js` and never touch the model. Phase 2 established that small
models are reliable at *constrained classification* and established nothing
about anything else, so nothing else is asked of them.

### MBTI from the stack, not from four tallies

Tallying E/I, N/S, T/F, J/P independently is the usual shortcut and it is wrong
in a way that matters: it can emit letter combinations whose implied function
stack is incoherent, and it discards the stack, which is the more interesting
object. `functionStack()` instead picks a dominant, constrains the auxiliary to
oppose it on **both** kind and attitude, and derives the rest. An incoherent
stack becomes unrepresentable, and Beebe's eight positions fall out for free.

J/P is the tell. It reports the attitude of whichever of the top two functions
faces outward — which is why INTJ leads with an *introverted* perceiving
function and still ends in J. All sixteen types are asserted in
`test/scoring.test.mjs`, derived from their top two functions alone.

### The gate

One item carries `gate: { scale, marginBelow }` and is asked only while that
scale's top two scores are within `marginBelow` of each other. It is Phase 4's
adaptive mechanic in its smallest honest form. `margin()` returns 0 for an
empty table on purpose: an empty table is maximally unresolved, and returning
Infinity there would gate away the very item meant to break the tie.

### Ties decide more than they should

The first real run made this plain. Twelve items produced `Ne 4, Ti 4` and a
three-way Enneagram tie at 2, so the printed type turned on the order functions
are declared in: `Ti` winning the same tie prints INTP instead of ENTP from
identical answers.

Tie-breaking stays deterministic — reproducibility matters more than a coin
flip — but a result that hides how contested it was overstates itself.

Reporting ties turned out not to be enough. A third run differing from the
second in **one answer** printed INTP instead of ENTP and reported *no ties at
all*: `Ti` led `Ne` by exactly 1, and items carry weights of up to 2. A tie is
just the special case where that lead is 0.

So `evidence` carries `margins` and a `fragile` flag — true whenever the leader
is ahead by no more than a single item is worth. With twelve items this fires
almost always, which is the honest signal: the instrument is thin and should
say so rather than print a confident four letters.

Weighting each answer by the model's confidence would break most of these ties
using information currently thrown away. That is deliberately **not** done yet:
confidence was measurably miscalibrated in the same run, and amplifying a
broken signal is worse than ignoring it.

### Unmeasured is a different claim from contested

Reporting ties still wasn't enough, because a tie at **zero** is not a close
contest — it is an absence wearing a contest's clothes.

A later run made that concrete. Only types 1, 2, 3 and 8 scored at all, and the
head centre came back `5` with 5, 6 and 7 tied at zero: one third of the
tritype decided by the order `CENTERS` happens to list its types, printed in
the same shape as a type that won something. Twelve items cannot cover nine
types, so this is the **normal** case rather than an edge one.

`contest()` now reports `evidenced` — whether the top score is above zero — and
everything downstream refuses to name a winner without it:

| | before | now |
| --- | --- | --- |
| head centre, all zero | `head: 5` | `head: null`, `unmeasured: ["head"]` |
| tritype, one centre reached | three entries | one entry |
| core with both wings zero | `8w7` | `8` |
| nothing answered at all | a four-letter type | `type: null` |
| dominant scored, auxiliary not | full stack | `dominant` only, no type |

`evidence.unmeasured` collects them dotted (`enneagram.head`, `mbti.auxiliary`)
so one field answers "what did the answers fail to reach".

A zero-tie is no longer reported as a tie, and `contested` no longer fires on
one. That is not a downgrade: `contested` means the answers disagreed,
`unmeasured` means they never arrived, and the second is both the stronger
admission and the more common one. `fragile` still fires either way.

The last row is the one that changed a shipped promise. A previous test
asserted that a visitor who abstains on everything still gets a coherent
four-letter type, reading #26's "every axis resolves" as "nothing is ever
null". That reading was wrong — a type read off eight zeroes is the `FUNCTIONS`
array in disguise. Nothing deadlocks, which is what the acceptance bar actually
asked for.

The alternative fix — hand-authoring items to cover the head centre — was
rejected. #26 capped the content at twelve deliberately, and an unresolved
centre is precisely the input Phase 4's generated follow-ups are meant to
consume. Adding items now would solve it in the way that makes Phase 4 harder
to justify.

### Confidence had no upward anchor

The same run returned `0.2` for *"Hold it and see if there's ways to poke holes
at it"* against a pole labelled **Hold it**, with a rationale claiming the
answer was hedged. It was verbatim.

The cause was in the prompt: three instructions pushed confidence *down* —
hedged answers, non-answers, the abstain fallback floor — and none pushed it
up. The model drifted low and stayed there. There is now an explicit
"plainly states a preference → above 0.8" anchor.

The bench could not see this, because `clean` cases asserted only the pole. A
`minConfidence` floor of 0.6 now applies to all four of them.

### The answer fence

Phase 2 measured two of three models obeying an instruction embedded in a
visitor's answer. Constrained decoding does not help — it stops an *invented*
pole and does nothing about an injection naming a real one.

`userPrompt()` now fences the answer between `<<<ANSWER` and `ANSWER>>>` and
tells the model the fenced region is data. `normalizeAnswer()` strips those
markers out of the answer itself, without which the fence is decorative: an
answer containing the closing marker walks straight out of the quoted region.

**It does not stop the model obeying an instruction inside the fence.** That is
now measured, not assumed: `injection-fence-escape` fails on Qwen3 1.7B in both
contract arms, and both arms carry the fence, so the fence is not the variable.
`injection-override` fails too under the abstain contract.

So the fence buys exactly one thing — an answer cannot escape the quoted region
and have its next line read as prompt, which the marker stripping guarantees and
a unit test pins. It buys nothing against instruction-following. Delimiting is a
structural defence and this is a semantic attack; that they are different things
is the finding.

The threat model here is mild — a visitor injecting into their own quiz only
misleads themselves, and there is no other user's data, no privileged action,
and no shared state to reach. It matters more in Phase 4, where generated
questions would be produced *from* visitor input, and that is where a real
mitigation belongs rather than here.

## Iterating without a browser

The measurement suite needs WebGPU, which build environments do not have, so
every prompt change used to cost a human a manual run. That made iterating on
the one part of this project that can only be settled empirically the most
expensive thing to do, which is the wrong incentive.

`scripts/bench-cli.mjs` runs the same cases through the same prompts and the
same parser against any OpenAI-compatible endpoint. Point it at llama.cpp
serving the same base model:

```sh
mkdir -p /workspaces/.llm && cd /workspaces/.llm

# CPU build, ~16 MB
curl -sSL -o llama.tar.gz https://github.com/ggml-org/llama.cpp/releases/download/b10612/llama-b10612-bin-ubuntu-x64.tar.gz
tar xzf llama.tar.gz && rm llama.tar.gz

# Qwen3 1.7B Q4_K_M, ~1.1 GB — within 12% of the WebLLM build's measured 984 MB
curl -sL -o qwen3-1.7b-q4.gguf \
  https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf

./llama-b10612/llama-server -m qwen3-1.7b-q4.gguf --port 8080 -c 4096 -t 2 --no-webui
```

then, from `typology/`:

```sh
npm run bench:cli -- --model qwen3-1.7b-q4.gguf --arm both --repeat 3
npm run bench:cli -- --model qwen3-1.7b-q4.gguf --arm abstain --limit 5 --json
```

Roughly 5 s per call on two CPU cores, so a full two-arm run is about four
minutes, times `--repeat`.

### What it does and does not measure

It shares `systemPrompt`, `userPrompt`, `schemaFor`, `parseClassification`,
`CASES` and `scoreCase` with the shipped path. Only the transport differs. So
it is a real measurement of **the prompt and the parser**.

It differs from the browser in three ways that matter:

| | shipped | CLI |
| --- | --- | --- |
| engine | WebLLM / TVM | llama.cpp |
| quantisation | q4f16_1 | Q4_K_M |
| grammar | xgrammar | GBNF |
| determinism | byte-identical at temp 0 | none |

**Always pass `--repeat`.** WebLLM returns byte-identical output for a repeated
input at temperature 0 — verified twice in the browser. llama.cpp does not:
continuous batching changes the order of floating-point reductions, so close
calls flip between runs. Measured here, one input in four disagreed with itself
across four attempts. A single run cannot support a one-case delta, and reading
one as signal is the specific mistake this tool makes easy. `--repeat` scores
the modal verdict and flags every case that disagreed with itself.

"Does the abstain instruction land" transfers. "Does xgrammar accept our
schema" does not, and neither does anything about WebGPU, the Cache API, the
storage gate, or the pages themselves. **Milestone verification stays a browser
run on real hardware** — this exists so that run is confirming a result rather
than discovering one.

Qwen3 emits `<think>` blocks unless told not to; the browser build does not, so
the CLI passes `enable_thinking: false`. Without it the two would be measuring
different models.

## Running it

```sh
npm test                          # 78 tests, no GPU or API key needed
npm run sizes                     # re-read model download sizes from HuggingFace
npx http-server . -p 8123 -s      # harness at /, bench at /bench.html, quiz at /quiz.html
```

## Layout

```
llm/contract.js    the interface, error taxonomy, per-item schema, ABSTAIN, the answer fence
llm/json.js        text -> classification recovery (pure; where the logic lives)
llm/scoring.js     function stack -> MBTI, and Enneagram core/wing/tritype (pure)
llm/items.js       the twelve-item bank, weights, and the gating rule (pure)
llm/bench.js       the measurement set and its scoring rules (pure)
llm/cache.js       what is on disk, and how to delete it
llm/capability.js  WebGPU / storage / connection detection
llm/local.js       WebLLM backend      llm/worker.js  engine host (off main thread)
llm/hosted.js      Gemini + Groq       llm/models.js  local model catalogue
llm/index.js       lazy backend factory
scripts/sizes.mjs  re-read real download sizes (dev only, not deployed)

index.html app.js         the harness
bench.html bench-app.js   the measurement runner
quiz.html  quiz-app.js    the twelve-item quiz
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
