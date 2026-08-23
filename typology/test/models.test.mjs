import { test } from "node:test";
import assert from "node:assert/strict";
import { LOCAL_MODELS, DEFAULT_LOCAL_MODEL, sizeOf, formatSize, isReliable } from "../llm/models.js";

const llama1b = LOCAL_MODELS.find((m) => m.id.includes("Llama-3.2-1B"));

test("the default is chosen on measured accuracy, not on size", () => {
  // Phase 1 defaulted to the 3B, which did not fit the first machine that ever
  // tried it. The first phase 2 fix over-corrected to the smallest, which the
  // bench then scored at 27% — it does not classify. Qwen3 1.7B scored 87% at
  // roughly half the 3B's download, so it is neither the largest nor the
  // smallest, which is the point: the default tracks results.
  const chosen = LOCAL_MODELS.find((m) => m.id === DEFAULT_LOCAL_MODEL);
  assert.ok(chosen, "default must exist in the catalogue");
  assert.notEqual(chosen.downloadMB, Math.max(...LOCAL_MODELS.map((m) => m.downloadMB)));
  assert.notEqual(chosen.downloadMB, Math.min(...LOCAL_MODELS.map((m) => m.downloadMB)));
});

test("every model carries a verified download size, not just a VRAM figure", () => {
  // `npm run sizes` re-reads these from HuggingFace and reports drift.
  for (const m of LOCAL_MODELS) {
    assert.ok(m.downloadMB > 0, `${m.label} has no downloadMB`);
    assert.ok(m.downloadMB < m.vramMB, `${m.label}: VRAM should exceed disk`);
  }
});

test("a verified catalogue size gates; the VRAM fallback only warns", () => {
  assert.equal(isReliable(sizeOf(llama1b, undefined)), true);
  assert.equal(isReliable({ megabytes: 879, source: "estimated" }), false);
  assert.equal(isReliable({ megabytes: 695, source: "floor" }), true);
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

test("with nothing on disk it uses the verified download size", () => {
  assert.deepEqual(sizeOf(llama1b, undefined), { megabytes: 705, source: "catalogue" });
  assert.deepEqual(sizeOf(llama1b, { cached: false, megabytes: 0 }),
                   { megabytes: 705, source: "catalogue" });
});

test("a model with no verified size falls back to VRAM, flagged", () => {
  const unknown = { id: "x", label: "X", vramMB: 4096 };
  assert.deepEqual(sizeOf(unknown, undefined), { megabytes: 4096, source: "estimated" });
});

test("formatting never overclaims what is known", () => {
  assert.equal(formatSize({ megabytes: 695, source: "measured" }), "695 MB");
  assert.equal(formatSize({ megabytes: 695, source: "floor" }), "695 MB+");
  assert.equal(formatSize({ megabytes: 705, source: "catalogue" }), "705 MB");
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
