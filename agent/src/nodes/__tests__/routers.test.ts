import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_REPAIRS_PER_RUN,
  MAX_REPAIRS_PER_TASK,
  attributable,
  repairable,
  routeAfterValidate,
  taskInFlight,
} from "../../graph/routers.ts";
import type { AgentState, BuildError, Task } from "../../graph/state.ts";

function task(id: string): Task {
  return {
    id,
    description: "Renders the collection it is given.",
    targetPath: `src/components/${id}.tsx`,
    taskType: "component",
    dependsOn: [],
    acceptance: ["Renders one row per item."],
  };
}

const FAILURE: BuildError = {
  file: "src/components/first.tsx",
  line: 12,
  code: "TS2322",
  message: "Type 'string' is not assignable to type 'number'.",
  source: "tsc",
};

/**
 * A run mid-queue. `cursor` is where `generate` left it — one past the task it
 * wrote — so the task in flight is `orderedTaskIds[cursor - 1]`.
 */
function stateFor(overrides: Partial<AgentState> = {}): AgentState {
  const tasks = [task("first"), task("second")];
  return {
    runId: "test-routers",
    spec: "One screen listing the collection, with a filter over it.",
    outputDir: "/nowhere",
    surface: {},
    projectSurface: {},
    tasks,
    orderedTaskIds: tasks.map((entry) => entry.id),
    cursor: 1,
    attempts: {},
    status: {},
    errors: [],
    reviewReport: null,
    reviewRounds: 0,
    usage: [],
    log: [],
    ...overrides,
  };
}

test("repairs a failing task while its budget lasts", () => {
  const state = stateFor({ errors: [FAILURE], attempts: { first: MAX_REPAIRS_PER_TASK - 1 } });

  assert.equal(routeAfterValidate(state), "repair");
  assert.equal(repairable(state), true);
});

test("gives up on a failing task once its budget is spent, and carries on", () => {
  const state = stateFor({ errors: [FAILURE], attempts: { first: MAX_REPAIRS_PER_TASK } });

  assert.equal(repairable(state), false);
  // The next task, not the end of the run: one bad task does not sink the rest.
  assert.equal(routeAfterValidate(state), "generate");
});

test("advances to the next task when the validation was clean", () => {
  assert.equal(routeAfterValidate(stateFor()), "generate");
});

test("ends the run when the validation was clean and the queue is empty", () => {
  assert.equal(routeAfterValidate(stateFor({ cursor: 2 })), "report");
});

test("ends the run when the last task of the queue is the one given up on", () => {
  const state = stateFor({
    cursor: 2,
    errors: [{ ...FAILURE, file: "src/components/second.tsx" }],
    attempts: { second: MAX_REPAIRS_PER_TASK },
  });

  assert.equal(attributable(state), true);
  assert.equal(routeAfterValidate(state), "report");
});

test("stops repairing anything once the whole run has spent its ceiling", () => {
  // Every task is within its own budget; the run as a whole is not.
  const spread = Object.fromEntries(
    Array.from({ length: MAX_REPAIRS_PER_RUN }, (_unused, index) => [`spent-${index}`, 1]),
  );
  const state = stateFor({ errors: [FAILURE], attempts: spread });

  assert.equal(state.attempts["first"], undefined);
  assert.equal(repairable(state), false);
  assert.equal(routeAfterValidate(state), "generate");
});

/**
 * A task of type `test` runs the whole suite, and the whole suite includes every
 * earlier task's tests. So a regression one task caused surfaces on a later,
 * innocent one — with an error naming a file that task does not own and cannot
 * rewrite.
 */
const SOMEONE_ELSES: BuildError = {
  file: "src/__tests__/Earlier.test.tsx",
  line: 9,
  code: "AssertionError",
  message: "renders the empty state: expected 0 rows to be 3",
  source: "vitest",
};

test("does not repair a failure that names no file the task owns", () => {
  const state = stateFor({ errors: [SOMEONE_ELSES] });

  assert.equal(attributable(state), false);
  // The budget is untouched, so nothing but attribution can be stopping it.
  assert.equal(repairable(state), true);
  assert.equal(routeAfterValidate(state), "generate");
});

test("repairs a failure the task caused in a file it does not own", () => {
  // The compiler reports a changed export at the importer, not at the file that
  // changed. One finding naming this task's own file is what makes the whole
  // set its business — and the importer's finding travels with it.
  const importer: BuildError = {
    file: "src/App.tsx",
    line: 4,
    code: "TS2305",
    message: "Module './first' has no exported member 'Panel'.",
    source: "tsc",
  };
  const state = stateFor({ errors: [FAILURE, importer] });

  assert.equal(attributable(state), true);
  assert.equal(routeAfterValidate(state), "repair");
});

test("refuses to repair a visit with no task in flight", () => {
  const state = stateFor({ cursor: 0, errors: [FAILURE] });

  assert.equal(taskInFlight(state), undefined);
  assert.equal(repairable(state), false);
  assert.equal(routeAfterValidate(state), "generate");
});
