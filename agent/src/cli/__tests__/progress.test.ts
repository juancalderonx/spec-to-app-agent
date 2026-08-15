import assert from "node:assert/strict";
import { test } from "node:test";
import { progressLine } from "../../cli/progress.ts";
import type { AgentState, Task, UsageEntry } from "../../graph/state.ts";

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

function usage(costUsd: number): UsageEntry {
  return {
    node: "generate",
    role: "coder",
    model: "test-model",
    inputTokens: 100,
    cachedReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 50,
    costUsd,
  };
}

/** A run mid-queue: `cursor` is one past the task `generate` just wrote. */
function stateFor(overrides: Partial<AgentState> = {}): AgentState {
  const tasks = [task("first"), task("second"), task("third")];
  return {
    runId: "test-progress",
    spec: "One screen listing the collection, with a filter over it.",
    outputDir: "/nowhere",
    surface: {},
    projectSurface: {},
    tasks,
    orderedTaskIds: tasks.map((entry) => entry.id),
    cursor: 2,
    attempts: {},
    status: { first: "done" },
    errors: [],
    reviewReport: null,
    reviewRounds: 0,
    usage: [usage(0.5), usage(0.3312)],
    log: [],
    ...overrides,
  };
}

test("reports position, the task in flight, elapsed time and cost to date", () => {
  const line = progressLine(stateFor(), 252_000, false);

  assert.equal(line, "progress 1/3 · second · 4m12s · $0.8312");
});

test("writes no escape sequence when the output is not a terminal", () => {
  const line = progressLine(stateFor(), 252_000, false);

  assert.doesNotMatch(line ?? "", /\u001b/);
});

test("colours the same figures when the output is a terminal", () => {
  const line = progressLine(stateFor(), 252_000, true);

  assert.match(line ?? "", /\u001b/);
  assert.equal((line ?? "").replaceAll(/\u001b\[[\d;]+m/g, ""), progressLine(stateFor(), 252_000, false));
});

test("counts a task the run gave up on as finished", () => {
  const line = progressLine(stateFor({ status: { first: "done", second: "failed" } }), 1000, false);

  assert.match(line ?? "", /^progress 2\/3 · second · 1s · /);
});

test("leaves the tasks in flight out when there are none", () => {
  const line = progressLine(stateFor({ cursor: 0 }), 61_000, false);

  assert.equal(line, "progress 1/3 · 1m01s · $0.8312");
});

test("does not count the remediation tasks a review queued as finished", () => {
  const state = stateFor({ status: { first: "done", second: "done", "remediation-1-1": "pending" } });

  assert.match(progressLine(state, 1000, false) ?? "", /^progress 2\/3 /);
});

test("says nothing before there is a plan to report a position in", () => {
  assert.equal(progressLine(stateFor({ orderedTaskIds: [] }), 1000, false), null);
});
