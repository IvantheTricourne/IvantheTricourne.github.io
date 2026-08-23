import { test } from "node:test";
import assert from "node:assert/strict";
import { LOCAL_MODELS, DEFAULT_LOCAL_MODEL, sizeOf, formatSize } from "../llm/models.js";

const llama1b = LOCAL_MODELS.find((m) => m.id.includes("Llama-3.2-1B"));

test("the default is a model that fits on the machines we have seen", () => {
  // Phase 1 defaulted to the 3B, which did not fit the storage quota on the
  // first machine that ever tried it. A default nobody can load is not one.
  assert.equal(DEFAULT_LOCAL_MODEL, LOCAL_MODELS[0].id);
  assert.equal(LOCAL_MODELS[0].vramMB, Math.min(...LOCAL_MODELS.map((m) => m.vramMB)));
});

test("a measured floor beats the VRAM estimate", () => {
  // Real numbers from the phase 2 smoke test: 695 MB on disk against an 879 MB
  // estimate for this model, and 979 vs 2,037 for Qwen3 1.7B. Requiring every
  // shard to carry Content-Length before trusting any of them threw the good
  // number away and reported the bad one as "measured".
  const partial = { cached: true, megabytes: 695, measured: false };
  assert.deepEqual(sizeOf(llama1b, partial), { megabytes: 695, source: "floor" });

  const complete = { cached: true, megabytes: 695, measured: true };
  assert.deepEqual(sizeOf(llama1b, complete), { megabytes: 695, source: "measured" });
});

test("with nothing on disk it falls back to the estimate, and says so", () => {
  assert.deepEqual(sizeOf(llama1b, undefined), { megabytes: 879, source: "estimated" });
  assert.deepEqual(sizeOf(llama1b, { cached: false, megabytes: 0 }),
                   { megabytes: 879, source: "estimated" });
});

test("formatting never overclaims what is known", () => {
  assert.equal(formatSize({ megabytes: 695, source: "measured" }), "695 MB");
  assert.equal(formatSize({ megabytes: 695, source: "floor" }), "695 MB+");
  assert.equal(formatSize({ megabytes: 879, source: "estimated" }), "~879 MB");
});

test("one model reports one size", () => {
  // The bug this pins: the picker read from sizeOf and the cache panel printed
  // raw bytes, so the same model showed 879 MB in one place and 695 MB+ two
  // lines below it, on the same screen.
  const cached = { cached: true, megabytes: 979, measured: false, entries: 33 };
  const qwen = LOCAL_MODELS.find((m) => m.id.includes("Qwen3"));
  assert.equal(formatSize(sizeOf(qwen, cached)), "979 MB+");
  assert.notEqual(sizeOf(qwen, cached).megabytes, qwen.vramMB);
});
