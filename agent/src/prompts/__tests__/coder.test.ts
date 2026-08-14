import assert from "node:assert/strict";
import { test } from "node:test";
import type { SurfaceManifest } from "../../graph/state.ts";
import { coderPrefix, coderRequest } from "../coder.ts";
import { loadPacks } from "../packs.ts";

const SPEC = "One screen listing the collection, with a filter over it.";

const PROJECT: SurfaceManifest = {
  "src/main.tsx": { exports: [] },
  "src/api/client.ts": { exports: [{ name: "client", signature: "const client: Client" }] },
};

/**
 * The failure this guards against is silent: a prefix that differs by one byte
 * from task to task still produces a correct application, at full price, with
 * nothing in the output to say the cache never fired.
 */
test("the cached prefix is the same bytes whatever the task type", () => {
  const forComponent = coderPrefix(SPEC, loadPacks("component").standing, PROJECT);
  const forTest = coderPrefix(SPEC, loadPacks("test").standing, PROJECT);

  assert.equal(forComponent, forTest);
});

test("the conventions for the task's type travel with the task, not the prefix", () => {
  const packs = loadPacks("test");

  assert.notEqual(packs.conventions, "");
  assert.ok(!coderPrefix(SPEC, packs.standing, PROJECT).includes(packs.conventions));
  assert.ok(
    coderRequest(
      {
        id: "list-panel-test",
        description: "Covers the empty state.",
        targetPath: "src/__tests__/ListPanel.test.tsx",
        taskType: "test",
        dependsOn: [],
        acceptance: ["Fails when the empty state disappears."],
      },
      {},
      packs.conventions,
    ).includes(packs.conventions),
  );
});
