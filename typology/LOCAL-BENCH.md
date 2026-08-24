# typology · running the bench on a local GPU

Follow-up to [#27](https://github.com/IvantheTricourne/IvantheTricourne.github.io/issues/27),
extending the README's *Iterating without a browser*. Written against an RTX
3080 (10 GB); anything with ~2 GB of spare VRAM will do for the 1.7B.

Everything below runs on one machine. A cloud dev environment cannot reach a
`localhost:8080` on the desktop, so the model, the server and the bench all
have to live on the same box.

## Why bother

Not speed for its own sake. **Every finding so far rests on one model.** The
fence is reverted on the strength of three arms of Qwen3 1.7B, and Qwen is the
model that *resists* injection — the case for a defence was always going to be
made, if anywhere, on a model that doesn't. A 3080 holds a second one.

Repeats are the other reason. llama.cpp disagrees with itself on roughly one
input in four — continuous batching reorders floating-point reductions, so close
calls flip between runs — and every cell so far is one sample at `--repeat 3`.

On two CPU cores a call takes ~5 s — measured, not estimated. Fully offloaded
to a 3080 it should be ~0.3–0.6 s. At 10x throughput `--repeat 15` costs about five minutes, the modal
verdict starts to mean something, and the agreement rate becomes data rather
than a caveat.

**The GPU does not make it deterministic.** More repeats is the fix; the card
just makes them affordable.

## Setup

Pinned build — same one the README uses, so results stay comparable:

- <https://github.com/ggml-org/llama.cpp/releases/tag/b10612>
- asset: `llama-b10612-bin-win-cuda-12.4-x64.zip`
  (CUDA 13.3 build is also there if your driver is new enough)
- if it complains about missing CUDA DLLs, unzip the `cudart-*` asset from the
  same release alongside it
- Linux equivalents are in the same release (`ubuntu-vulkan-x64` works on
  NVIDIA without a CUDA toolchain)

Model (1.1 GB, within 12% of the WebLLM build's measured 984 MB):

```
https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf
```

Serve it:

```sh
llama-server.exe -m qwen3-1.7b-q4.gguf --port 8080 -c 4096 -ngl 99 --no-webui
```

`-ngl 99` is the whole difference — it offloads every layer to the GPU. **Check
the startup log actually says the layers are on CUDA**; a silent CPU fallback
looks identical except for being slow, and would quietly produce numbers that
are not comparable to a GPU run.

Repo side — zero dependencies, Node only:

```sh
git clone https://github.com/IvantheTricourne/IvantheTricourne.github.io
cd IvantheTricourne.github.io/typology
npm test          # expect all green before trusting any run
```

The three-arm `--fence` flag arrived with the fence split; on a branch that
predates it, `--fence both` still gives the two ends. Since #34, `--fence off`
is the default and the shipping prompt.

## Run 1 — confirm the fence verdict at depth (already answered on CPU)

```sh
npm run bench:cli -- --model qwen3-1.7b-q4.gguf --arm abstain --fence all --repeat 15
```

Three arms:

| arm | what it sends |
| --- | --- |
| `on` | markers + stripping + exhortation — what ships |
| `markers` | markers + stripping, no exhortation — **the new one** |
| `off` | Phase 2 format, no defence at all |

**This run has been done** on two CPU cores at `--repeat 3`, and it is what
#34 reverted the fence on:

| | `on` | `markers` | `off` |
| --- | --- | --- | --- |
| scored | 12/16 | 12/16 | 13/16 |
| adversarial | 1/3 | 1/3 | 2/3 |
| declined | 7/21 | 9/21 | 11/21 |

Declines fall monotonically as the defence comes off, so both halves suppress
abstention rather than just the exhortation, and the bare arm is the only one
that resisted `injection-override`. `injection-fence-escape` failed in all
three.

Re-running it on the GPU is now a **confirmation**, not a decision — worth the
five minutes because `--repeat 15` turns each cell from one sample into a modal
verdict, and because `on` and `off` render byte-identical prompts to what #32
and #34 both measured. If the decline ordering survives 15 repeats it is
settled; if the three shuffle, the honest finding is that 16 cases cannot
resolve it and the revert stands on threat model instead.

Do it second. Run 2 is the one that can still change something.

## Run 0 — the one that needs your browser, not your GPU (start here)

Ten minutes, no llama.cpp, and it is the highest-value thing on this page.

The quiz's local path fabricates on a blank answer where llama.cpp declines, and
a quantization ladder narrowed it to the build: every 4-bit-and-up llama.cpp
rung declines all four non-answers, the 2-bit rung fabricates all four at
0.90–1.00. The browser's `q4f16_1-MLC` is behaving like the 2-bit rung.

WebLLM ships **`Qwen3-1.7B-q4f32_1-MLC`** — the same 4-bit weights with fp32
activations rather than fp16. It is not in `llm/models.js`; add it by hand, or
point the harness at it, and take the quiz **leaving three or four items
blank**:

- it declines → f16 accumulation is the cause, and the fix is a catalogue entry
- it fabricates too → the cause is xgrammar, and the local path's abstention
  guarantee does not exist in any build we ship

Either result closes a question no amount of CPU benchmarking can reach. It also
wants ~2 GB of VRAM against q4f16_1's ~3.8 GB, so it is the cheaper model
despite the wider activations.

## Run 2 — is any of this Qwen-specific?

The whole fence verdict is one model's behaviour. 10 GB holds more:

- Llama 3.2 3B Q4_K_M — ~2 GB, and Phase 2 measured it at 80% in the browser
- a 7–8B Q4_K_M — ~4.7 GB, comfortable, and leaves room to keep a second
  model resident rather than reloading between arms
- a 14B Q4_K_M — ~9 GB, tight but it fits, and it is the first size where
  "can a small model write questions" stops being a leading question

```sh
npm run bench:cli -- --model llama-3.2-3b-q4.gguf --arm abstain --fence all --repeat 15
```

Phase 2 found Llama 3.2 3B was one of the two models that **obeyed** an
injection where Qwen resisted. That makes it the one model that could still
overturn #34: if a defence ever earns its abstention cost, it earns it on a
model that needs defending. If the fence loses here too, it is finished, and
`--fence` can come out of the code entirely rather than living on as an arm.

## Run 3 — the abstention path in the quiz, not the bench

Unrelated to the fence, and still outstanding: `abstained: 0` on both real quiz
runs. 114 bench runs have exercised abstention; the product never has.

Open `/typology/quiz.html`, pick Qwen3 1.7B, and **leave one item blank or
answer it off-topic** — this one needs WebGPU rather than llama.cpp, so it is
the browser half of the same afternoon. Then check the result JSON for `abstained: 1` and that
the axis it belonged to shows up in `evidence.unmeasured` (that field
arrived with [#33](https://github.com/IvantheTricourne/IvantheTricourne.github.io/pull/33)).

## What to record

Keep the summary blocks — the per-arm `scored / category / declined / unscored
/ repairs / median` lines and any `UNSTABLE` list. `--json` gives the full rows
if a specific case looks worth arguing about.

Worth noting alongside: median ms per call, and whether the server log
confirmed CUDA offload.

## Open follow-ups this feeds

From #27:

- [x] split the fence and re-measure — done on CPU, reverted in #34; Run 1
      confirms it at depth and Run 2 is the one that could still overturn it
- [ ] make the hint-leak measurable — two real quiz items failed by quoting
      pole hint text back as the person's words; needs a named bench case
      before Phase 4's item generation gets specced on one anecdote
- [ ] Phase 4's gating question: can a small model *write* questions, not just
      classify answers? Untested, and probably needs the 7–8B class model that
      only fits on the desktop
