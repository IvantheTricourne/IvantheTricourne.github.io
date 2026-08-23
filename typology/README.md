# typology

An exploration project for shipping LLM-capable webapps on a static host.
Tracking issue: [#27](https://github.com/IvantheTricourne/IvantheTricourne.github.io/issues/27).

The typology quiz (MBTI + Enneagram tritype) is the *vehicle* — it generates
real classification work for a model. It is not the goal, and it is explicitly
not intended as a rigorous instrument.

## Phase 1 — the harness (#24)

One `classify()` contract, two interchangeable backends:

| backend | credentials | cost to this site | reach |
| --- | --- | --- | --- |
| `local` — WebLLM over WebGPU | none, no key exists | none; weights come from HuggingFace's CDN | WebGPU only |
| `hosted` — Gemini or Groq | the **visitor's** own key | none | anywhere |

No key belonging to this site exists in this codebase, and there is no proxy.
A key shipped to the browser would be public, and an unauthenticated relay
would be drained by whoever found it first.

```
llm/contract.js    the interface, error taxonomy, per-item JSON schema
llm/json.js        text -> classification recovery (pure; where the logic lives)
llm/capability.js  WebGPU / storage / connection detection
llm/local.js       WebLLM backend      llm/worker.js  engine host (off main thread)
llm/hosted.js      Gemini + Groq       llm/models.js  local model catalogue
llm/index.js       lazy backend factory
```

Backends are imported lazily. Loading `llm/index.js` pulls no WebLLM and makes
no off-origin request — verified, the page loads fully offline. Someone using a
hosted key never pays to fetch a library they will not run.

## Running it

```sh
npm test                          # 20 tests, no GPU or API key needed
npx http-server . -p 8123 -s      # then open http://127.0.0.1:8123/
```

`package.json` exists only to mark `llm/*.js` as ES modules for `node --test`.
The browser never reads it.

## What is and is not verified

Verified in a real browser: page load, module resolution, WebGPU detection,
the no-WebGPU degradation path (local disabled, hosted auto-selected), zero
off-origin requests on load. Verified in Node: all of `llm/json.js`, and the
request shapes both hosted providers are sent.

**Not** verified: live local inference (needs a GPU and a multi-gigabyte
download) and live hosted calls (needs a key). The hosted request shapes are
written against each provider's documented REST API; both vendors' doc hosts
are blocked from the build environment, so `PROVIDERS` in `hosted.js` is
deliberately the single place to correct if a field name or model id has
drifted.

Measuring how often small models actually produce usable output — and which
repairs in `json.js` carry the load — is Phase 2 (#25).
