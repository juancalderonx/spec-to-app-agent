import assert from "node:assert/strict";
import { test } from "node:test";
import { validatePlan } from "../plan.ts";

/** One well-formed task, so each case can state only what it changes. */
function task(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "list-view",
    description: "Renders the collection returned by the data layer.",
    targetPath: "src/components/ListView.tsx",
    taskType: "component",
    dependsOn: [],
    acceptance: ["Renders one row per item."],
    ...overrides,
  };
}

/** The failures, as the sentences the retry sends back. */
function errorsOf(value: unknown): string[] {
  const validation = validatePlan(value);
  return validation.ok ? [] : validation.errors;
}

test("accepts a well-formed plan and hands back typed tasks", () => {
  const validation = validatePlan({
    tasks: [task(), task({ id: "list-test", taskType: "test", dependsOn: ["list-view"] })],
  });

  assert.equal(validation.ok, true);
  if (!validation.ok) {
    return;
  }
  assert.deepEqual(
    validation.tasks.map((parsed) => parsed.id),
    ["list-view", "list-test"],
  );
  assert.equal(validation.tasks[1]?.taskType, "test");
});

test("rejects a task type outside the fixed vocabulary", () => {
  const errors = errorsOf({ tasks: [task({ taskType: "documentation" })] });

  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? "", /taskType must be one of/);
  assert.match(errors[0] ?? "", /"documentation"/);
});

test("rejects a dependency on an id that is not in the plan", () => {
  const errors = errorsOf({ tasks: [task({ dependsOn: ["data-layer"] })] });

  assert.deepEqual(errors, [
    'Task "list-view" depends on "data-layer", which is not a task in this plan.',
  ]);
});

test("rejects two tasks sharing an id", () => {
  const errors = errorsOf({ tasks: [task(), task({ targetPath: "src/other.tsx" })] });

  assert.deepEqual(errors, ['Two tasks share the id "list-view". Ids must be unique.']);
});

// A resolvable dependency is not the same as an acyclic one, and a cycle that
// reaches the topological sort ends the run with the plan already on disk.
test("rejects a cycle and names the path that closes it", () => {
  const errors = errorsOf({
    tasks: [
      task({ id: "a", dependsOn: ["b"] }),
      task({ id: "b", dependsOn: ["c"] }),
      task({ id: "c", dependsOn: ["a"] }),
    ],
  });

  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? "", /cycle: a -> b -> c -> a\./);
});

test("rejects a task that depends on itself", () => {
  const errors = errorsOf({ tasks: [task({ id: "a", dependsOn: ["a"] })] });

  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? "", /cycle: a -> a\./);
});

test("accepts a diamond, which reaches a task twice without closing a cycle", () => {
  const validation = validatePlan({
    tasks: [
      task({ id: "base", dependsOn: [] }),
      task({ id: "left", dependsOn: ["base"] }),
      task({ id: "right", dependsOn: ["base"] }),
      task({ id: "top", dependsOn: ["left", "right"] }),
    ],
  });

  assert.equal(validation.ok, true);
});

test("rejects malformed fields, one sentence each", () => {
  const errors = errorsOf({
    tasks: [task({ id: "  ", acceptance: ["fine", 7] }), "not an object"],
  });

  assert.deepEqual(errors, [
    "tasks[0].id must be a non-empty string.",
    "tasks[0].acceptance must be an array of strings.",
    "tasks[1] must be an object.",
  ]);
});

test("rejects an answer that is not a task list at all", () => {
  assert.deepEqual(errorsOf({ plan: [] }), [
    'The answer must be an object holding a "tasks" array.',
  ]);
  assert.deepEqual(errorsOf({ tasks: [] }), [
    "The plan holds no tasks. It must hold at least one.",
  ]);
});
