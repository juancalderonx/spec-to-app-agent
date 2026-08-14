import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentState, BuildError, TaskStatus } from "../state.ts";
import { failedTasks, runVerdict } from "../verdict.ts";

/** Only the two fields the verdict reads are worth setting; the rest is filler. */
function stateFor(status: Record<string, TaskStatus>, errors: BuildError[] = []): AgentState {
  return {
    runId: "test-verdict",
    spec: "",
    outputDir: "/tmp-never-written-by-this-test",
    surface: {},
    projectSurface: {},
    tasks: [],
    orderedTaskIds: [],
    cursor: 0,
    attempts: {},
    status,
    errors,
    reviewReport: null,
    reviewRounds: 0,
    usage: [],
    log: [],
  };
}

const TYPE_ERROR: BuildError = {
  file: "src/components/ListPanel.tsx",
  line: 12,
  code: "TS2322",
  message: "Type 'string' is not assignable to type 'number'.",
  source: "tsc",
};

test("a run whose every task is done exits 0", () => {
  assert.equal(runVerdict(stateFor({ "a-first": "done", "b-second": "done" })), 0);
  assert.equal(runVerdict(stateFor({})), 0);
});

/**
 * The one this file exists for.
 *
 * `errors` is empty here, which is the ordinary end of a run: it holds the last
 * validation, and the last task validated clean. A verdict read from that field
 * alone calls this run a success while its own log names the task it gave up on.
 */
test("a run with a failed task exits 1 even though the last validation was clean", () => {
  const state = stateFor({ "a-first": "done", "b-second": "failed", "c-third": "done" }, []);

  assert.equal(state.errors.length, 0);
  assert.equal(runVerdict(state), 1);
});

test("a failure that reached no task still fails the run", () => {
  // `prepare` and `order` end a run before any task has a status at all.
  assert.equal(runVerdict(stateFor({}, [TYPE_ERROR])), 1);
});

test("names the failed tasks, in an order that does not move between runs", () => {
  const state = stateFor({ "c-third": "failed", "a-first": "failed", "b-second": "done" });

  assert.deepEqual(failedTasks(state), ["a-first", "c-third"]);
  assert.deepEqual(failedTasks(stateFor({ "a-first": "done" })), []);
});
