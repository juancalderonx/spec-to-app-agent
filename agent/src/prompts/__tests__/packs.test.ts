import assert from "node:assert/strict";
import { test } from "node:test";
import { TASK_TYPES } from "../../graph/state.ts";
import { loadPacks } from "../packs.ts";

test("every task type in the fixed vocabulary has a pack of its own", () => {
  for (const taskType of TASK_TYPES) {
    const selection = loadPacks(taskType);
    assert.deepEqual(
      selection.names,
      ["rules", taskType],
      `"${taskType}" fell back to the standing pack. Add agent/knowledge/${taskType}.md.`,
    );
    assert.equal(selection.fallback, null);
    assert.ok(selection.standing.startsWith("# Standing constraints"));
    assert.notEqual(selection.conventions, "");
  }
});

test("an unrecognised task type gets the standing pack alone, and says so", () => {
  const selection = loadPacks("orchestration");

  assert.deepEqual(selection.names, ["rules"]);
  assert.ok(selection.standing.startsWith("# Standing constraints"));
  assert.equal(selection.conventions, "");
  assert.match(selection.fallback ?? "", /orchestration/);
});
