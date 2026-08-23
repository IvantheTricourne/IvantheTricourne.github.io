import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as index from "../llm/index.js";

/**
 * The barrel and its consumers, kept in sync.
 *
 * llm/index.js re-exports what the pages import. Adding a helper to models.js,
 * using it in app.js, and forgetting the re-export produces a page that throws
 * on load with everything below the import silently dead — and it is invisible
 * to `node --check`, to every unit test, and to a syntax-only review. It
 * happened twice in one afternoon (`formatSize`, then `isReliable`), which is
 * what this test is for.
 */
const NAMED = /import\s*\{([^}]+)\}\s*from\s*"\.\/llm\/index\.js"/;

for (const page of ["app.js", "bench-app.js"]) {
  test(`${page} imports only symbols the barrel actually exports`, () => {
    const match = readFileSync(new URL(`../${page}`, import.meta.url), "utf8").match(NAMED);
    assert.ok(match, `${page} has no named import from ./llm/index.js`);
    const imported = match[1].split(",").map((s) => s.trim()).filter(Boolean);
    assert.ok(imported.length > 0);
    const missing = imported.filter((name) => !(name in index));
    assert.deepEqual(missing, [], `${page} imports names the barrel does not export`);
  });
}
