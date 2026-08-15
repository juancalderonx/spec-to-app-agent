import assert from "node:assert/strict";
import { test } from "node:test";
import { hasEscape, width } from "../../cli/ansi.ts";
import {
  estimateRemaining,
  finishedCount,
  layoutLogs,
  readSteps,
  renderDashboard,
  trackTimings,
  waitingLine,
  type LogLine,
  type Step,
  type View,
} from "../../cli/dashboard.ts";
import type { AgentState, Task, UsageEntry } from "../../graph/state.ts";

function task(id: string): Task {
  return {
    id,
    description: "Renders the collection it is given.",
    targetPath: `src/components/${id}.tsx`,
    taskType: "component",
    dependsOn: [],
    acceptance: [],
  };
}

function usage(task: string, costUsd: number): UsageEntry {
  return {
    node: "generate",
    task,
    role: "coder",
    model: "test-model",
    inputTokens: 10,
    cachedReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 5,
    costUsd,
  };
}

function stateFor(overrides: Partial<AgentState> = {}): AgentState {
  const tasks = [task("first"), task("second"), task("third")];
  return {
    runId: "test-dashboard",
    spec: "One screen listing the collection.",
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
    usage: [usage("first", 0.25), usage("second", 0.5)],
    log: [],
    ...overrides,
  };
}

const LOGS: LogLine[] = [
  { time: "06:22:08", node: "prepare", text: "installed: npm install exited 0" },
  { time: "06:22:11", node: "generate", text: "wrote: first → src/components/first.tsx" },
];

function viewFor(overrides: Partial<View> = {}): View {
  const steps = readSteps(stateFor(), ["second"], { first: { startedAt: 0, endedAt: 60_000 } }, 120_000);
  return {
    facts: {
      runId: "app-2026-08-15T06-22-08-872Z",
      provider: "anthropic",
      model: "test-model",
      cache: "on",
      startedAt: new Date("2026-08-15T06:22:08.872Z"),
    },
    status: "running",
    steps,
    logs: LOGS,
    elapsedMs: 120_000,
    costUsd: 0.75,
    scrollback: 0,
    frame: 0,
    idleMs: 12_000,
    ...overrides,
  };
}

test("starts a clock when a task takes the floor and stops it when the task settles", () => {
  const first = trackTimings({}, stateFor({ status: {} }), ["first"], 1_000);
  assert.deepEqual(first["first"], { startedAt: 1_000, endedAt: undefined });

  const settled = trackTimings(first, stateFor({ status: { first: "done" } }), ["second"], 5_000);
  assert.deepEqual(settled["first"], { startedAt: 1_000, endedAt: 5_000 });
  assert.deepEqual(settled["second"], { startedAt: 5_000, endedAt: undefined });
});

test("a settled clock is not restarted by a later observation", () => {
  const once = trackTimings({}, stateFor({ status: { first: "done" } }), ["first"], 1_000);
  const twice = trackTimings(once, stateFor({ status: { first: "done" } }), [], 9_000);

  assert.equal(twice["first"]?.endedAt, 1_000);
});

test("gives each step its status, its clock and what it spent", () => {
  const steps = readSteps(stateFor(), ["second"], { second: { startedAt: 0, endedAt: undefined } }, 30_000);

  assert.deepEqual(
    steps.map((step) => [step.id, step.status, step.costUsd]),
    [
      ["first", "done", 0.25],
      ["second", "running", 0.5],
      ["third", "pending", 0],
    ],
  );
  assert.equal(steps[1]?.elapsedMs, 30_000);
  assert.equal(steps[2]?.elapsedMs, undefined);
});

test("counts a task the run gave up on as finished", () => {
  const steps = readSteps(stateFor({ status: { first: "done", second: "failed" } }), [], {}, 0);

  assert.equal(finishedCount(steps), 2);
});

test("says nothing about what is left until something has finished", () => {
  const nothing: Step[] = [
    { id: "first", status: "running", elapsedMs: 1_000, costUsd: 0 },
    { id: "second", status: "pending", elapsedMs: undefined, costUsd: 0 },
  ];

  assert.equal(estimateRemaining(nothing, 60_000), undefined);
});

test("extrapolates what is left from the pace kept so far", () => {
  const steps: Step[] = [
    { id: "first", status: "done", elapsedMs: 60_000, costUsd: 0 },
    { id: "second", status: "pending", elapsedMs: undefined, costUsd: 0 },
    { id: "third", status: "pending", elapsedMs: undefined, costUsd: 0 },
  ];

  assert.equal(estimateRemaining(steps, 60_000), 120_000);
});

test("wraps a log line to the pane and indents what it carried over", () => {
  const long: LogLine = { time: "06:22:08", node: "order", text: `ordered: ${"step ".repeat(20).trim()}` };

  const lines = layoutLogs([long], 40, false);

  assert.ok(lines.length > 1);
  for (const line of lines) {
    assert.ok(width(line) <= 40, `line overflows the pane: ${JSON.stringify(line)}`);
  }
  assert.match(lines[0] ?? "", /^ 06:22:08 \[order\]/);
  assert.match(lines[1] ?? "", /^ {10} {2}\S/);
});

test("draws every row to the width it was given, at any size", () => {
  for (const size of [
    { columns: 80, rows: 24 },
    { columns: 120, rows: 40 },
    { columns: 60, rows: 16 },
    { columns: 200, rows: 60 },
  ]) {
    // Both palettes: `width` discounts the escapes, so a coloured frame that
    // overflows is a padding bug the plain one cannot show.
    for (const colour of [false, true]) {
      const frame = renderDashboard(viewFor(), size, colour).split("\n");

      assert.ok(frame.length <= size.rows, `${size.columns}x${size.rows}: too many rows`);
      for (const line of frame) {
        assert.ok(
          width(line) <= Math.max(size.columns, 40),
          `${size.columns}x${size.rows} colour=${colour}: ${JSON.stringify(line)}`,
        );
      }
    }
  }
});

test("writes no escape sequence when the output is not a terminal", () => {
  assert.ok(!hasEscape(renderDashboard(viewFor(), { columns: 120, rows: 40 }, false)));
  assert.ok(hasEscape(renderDashboard(viewFor(), { columns: 120, rows: 40 }, true)));
});

test("shows the run's facts, its position and its cost on the same screen", () => {
  const frame = renderDashboard(viewFor(), { columns: 120, rows: 40 }, false);

  // Cut to the pane, which is what a run id that long does in 38 columns.
  assert.match(frame, /app-2026-08-15T06-22-0…/);
  assert.match(frame, /anthropic/);
  assert.match(frame, /1 \/ 3 \(33%\)/);
  assert.match(frame, /\$0\.7500/);
  assert.match(frame, /installed: npm install exited 0/);
});

test("says the run stopped instead of claiming it is still running", () => {
  const frame = renderDashboard(viewFor({ status: "stopped" }), { columns: 120, rows: 40 }, false);

  assert.match(frame, /Stopped/);
  assert.doesNotMatch(frame, /Running/);
});

test("shows the newest lines by default and older ones once scrolled", () => {
  const many = Array.from({ length: 60 }, (_, index) => ({
    time: "06:22:08",
    node: "generate",
    text: `line-${index}`,
  }));
  const size = { columns: 120, rows: 24 };

  const tail = renderDashboard(viewFor({ logs: many }), size, false);
  const scrolled = renderDashboard(viewFor({ logs: many, scrollback: 40 }), size, false);

  assert.match(tail, /line-59/);
  assert.doesNotMatch(tail, /line-1\b/);
  assert.match(scrolled, /line-1\b/);
  assert.doesNotMatch(scrolled, /line-59/);
});

test("says what the run is waiting on while the log is silent", () => {
  const line = waitingLine(viewFor(), false);

  assert.match(line, /waiting on second · 12s/);
});

test("names the last node when no task is in flight yet", () => {
  const steps = readSteps(stateFor({ orderedTaskIds: [], status: {} }), [], {}, 0);

  assert.match(waitingLine(viewFor({ steps }), false), /waiting on \[generate\]/);
  assert.match(waitingLine(viewFor({ steps, logs: [] }), false), /waiting on the first line/);
});

test("turns while it waits, and stops turning once the run is over", () => {
  const first = waitingLine(viewFor({ frame: 0 }), false);
  const second = waitingLine(viewFor({ frame: 1 }), false);

  assert.notEqual(first, second);
  assert.match(waitingLine(viewFor({ status: "finished" }), false), /✓ finished · 1\/3/);
  assert.match(waitingLine(viewFor({ status: "stopped" }), false), /■ stopped · 1\/3/);
});

test("keeps a blank row between the last log line and the waiting line, however full the pane is", () => {
  const many = Array.from({ length: 200 }, (_, index) => ({
    time: "06:22:08",
    node: "generate",
    text: `line-${index}`,
  }));

  for (const size of [
    { columns: 120, rows: 40 },
    { columns: 80, rows: 24 },
    { columns: 60, rows: 16 },
  ]) {
    const frame = renderDashboard(viewFor({ logs: many }), size, false).split("\n");
    const waiting = frame.findIndex((line) => line.includes("waiting on"));

    assert.notEqual(waiting, -1, `${size.columns}x${size.rows}: no waiting line`);
    assert.doesNotMatch(frame[waiting - 1] ?? "", /line-\d/, `${size.columns}x${size.rows}: they touch`);
    assert.match(frame[waiting - 2] ?? "", /line-\d/, `${size.columns}x${size.rows}: a gap of more than one`);
  }
});
