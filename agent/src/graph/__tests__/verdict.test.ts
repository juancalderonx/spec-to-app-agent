import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentState, BuildError, Task, TaskStatus } from "../state.ts";
import { failedTasks, openGaps, runVerdict } from "../verdict.ts";

/** Only the fields the verdict reads are worth setting; the rest is filler. */
function stateFor(
  status: Record<string, TaskStatus>,
  errors: BuildError[] = [],
  tasks: Task[] = [],
): AgentState {
  return {
    runId: "test-verdict",
    spec: "",
    outputDir: "/tmp-never-written-by-this-test",
    surface: {},
    projectSurface: {},
    tasks,
    orderedTaskIds: tasks.map((task) => task.id),
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

/** The two tasks the same file was written for: the one that died and the one
 * the review queued to close the same gap. */
const ABANDONED: Task = {
  id: "list-test",
  description: "Covers the behaviour the specification asks to be tested.",
  targetPath: "src/components/__tests__/List.test.tsx",
  taskType: "test",
  dependsOn: [],
  acceptance: ["The stated behaviour is asserted."],
};

const REMEDIATION: Task = { ...ABANDONED, id: "remediation-1-1" };

/**
 * The exit code asks what the run left open, not whether anything ever went
 * wrong. A remediation that came back green wrote the very file its gap named,
 * so the requirement is met and the workspace is whole — the first full run
 * exited 1 over an application with nothing wrong with it.
 */
test("a failure a later task wrote clean over is not a gap the run still has", () => {
  const state = stateFor(
    { "list-test": "failed", "remediation-1-1": "done" },
    [],
    [ABANDONED, REMEDIATION],
  );

  // History is left exactly as it happened: the task did fail, and the summary's
  // table is where a reader sees it fail and sees the next one close it.
  assert.deepEqual(failedTasks(state), ["list-test"]);
  assert.deepEqual(openGaps(state), []);
  assert.equal(runVerdict(state), 0);
});

test("a failure nobody wrote over stays open, and the run says so", () => {
  const state = stateFor({ "list-test": "failed" }, [], [ABANDONED]);

  assert.deepEqual(openGaps(state), ["list-test"]);
  assert.equal(runVerdict(state), 1);
});

test("names the failed tasks, in an order that does not move between runs", () => {
  const state = stateFor({ "c-third": "failed", "a-first": "failed", "b-second": "done" });

  assert.deepEqual(failedTasks(state), ["a-first", "c-third"]);
  assert.deepEqual(failedTasks(stateFor({ "a-first": "done" })), []);
});
