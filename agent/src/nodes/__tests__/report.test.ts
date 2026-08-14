import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import type { AgentState, BuildError, Task, UsageEntry } from "../../graph/state.ts";
import { report } from "../report.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

/** Where a run's artifacts land, and what this file cleans up after itself. */
function runDirectory(runId: string): string {
  const directory = join(REPO_ROOT, "agent", "runs", runId);
  after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    description: "Renders the collection it is given.",
    targetPath: `src/components/${id}.tsx`,
    taskType: "component",
    dependsOn: [],
    acceptance: ["Renders one row per item."],
    ...overrides,
  };
}

function spend(overrides: Partial<UsageEntry> = {}): UsageEntry {
  return {
    node: "generate",
    role: "coder",
    model: "claude-opus-5",
    inputTokens: 1_000,
    cachedReadTokens: 8_000,
    cacheWriteTokens: 0,
    outputTokens: 2_000,
    costUsd: 0.059,
    ...overrides,
  };
}

/** A finished run: three tasks, one of each status the summary has to show. */
function stateFor(runId: string, overrides: Partial<AgentState> = {}): AgentState {
  const tasks = [task("a-first"), task("b-second"), task("c-third")];
  return {
    runId,
    spec: "One screen listing the collection, with a filter over it.",
    outputDir: "/nowhere",
    surface: {},
    projectSurface: {},
    tasks,
    orderedTaskIds: tasks.map((entry) => entry.id),
    cursor: 3,
    attempts: { "b-second": 2 },
    status: { "a-first": "done", "b-second": "failed", "c-third": "pending" },
    errors: [],
    reviewReport: { gaps: [], verdict: "Every requirement is covered." },
    reviewRounds: 1,
    usage: [
      spend({ node: "plan", role: "planner", outputTokens: 3_000 }),
      spend({ task: "a-first" }),
      spend({ task: "b-second", inputTokens: 1_100 }),
      spend({ node: "repair", task: "b-second", inputTokens: 1_200 }),
      spend({ task: "c-third", inputTokens: 1_300 }),
      spend({ node: "review", role: "reviewer", model: "claude-sonnet-5" }),
    ],
    log: [],
    ...overrides,
  };
}

test("writes the three artifacts it owns, completing the run's five", async () => {
  const runId = "test-report-artifacts";
  const directory = runDirectory(runId);
  // The two `report` does not own, written where they are produced: `plan.json`
  // by `plan` as soon as a plan validates, `tools.jsonl` by the trace.
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "plan.json"), "[]\n", "utf8");
  await writeFile(join(directory, "tools.jsonl"), "", "utf8");

  const failure: BuildError = {
    file: "src/components/b-second.tsx",
    line: 12,
    code: "TS2322",
    message: "Type 'string' is not assignable to type 'number'.",
    source: "tsc",
  };
  const result = await report(stateFor(runId, { errors: [failure] }));

  for (const artifact of ["plan.json", "tools.jsonl", "errors.jsonl", "usage.json", "summary.md"]) {
    await readFile(join(directory, artifact), "utf8");
  }
  assert.deepEqual(
    JSON.parse(await readFile(join(directory, "errors.jsonl"), "utf8")),
    failure,
  );

  const ledger: unknown = JSON.parse(await readFile(join(directory, "usage.json"), "utf8"));
  assert.equal(
    typeof ledger === "object" && ledger !== null && "totals" in ledger && "entries" in ledger,
    true,
  );
  assert.equal(result.log?.[0]?.event, "wrote");
});

test("the summary states the run's cost, split by kind of token", async () => {
  const runId = "test-report-cost";
  const directory = runDirectory(runId);

  await report(stateFor(runId));
  const summary = await readFile(join(directory, "summary.md"), "utf8");

  // 6 calls: 6 × 1000-ish uncached input, 6 × 8000 cached read, output-heavy.
  assert.match(summary, /6 calls/);
  assert.match(summary, /input, cache read \| 48000/);
  assert.match(summary, /Total: \*\*\$\d+\.\d{4}\*\*/);
  // The share column is what answers "what did the run spend it on": a bill that
  // is almost all output is the evidence the prompt stayed small.
  assert.match(summary, /\| output \| 13000 \| \$\d+\.\d{4} \| \d+\.\d%/);
  assert.match(summary, /### By role/);
  assert.match(summary, /reviewer \| claude-sonnet-5/);
  assert.match(summary, /### By node/);
});

test("the summary gives every task a status, including the unresolved one", async () => {
  const runId = "test-report-tasks";
  const directory = runDirectory(runId);

  await report(stateFor(runId));
  const summary = await readFile(join(directory, "summary.md"), "utf8");
  const rows = summary.split("\n").filter((line) => /^\| \d+ \| /.test(line));

  assert.deepEqual(
    rows.map((row) => row.split(" | ")[1]),
    ["a-first", "b-second", "c-third"],
  );
  assert.match(rows[0] ?? "", /\| done \|/);
  assert.match(rows[1] ?? "", /\| failed \|/);
  // Neither done nor failed: attempted, and its validation never came back clean
  // about anything it owns. Collapsing it into either column hides it.
  assert.match(rows[2] ?? "", /\| unresolved \|/);
  assert.match(summary, /3 tasks · 1 done · 1 failed · 1 unresolved/);

  // Input tokens per task, in execution order: the number §4 rests on. The
  // repair's 1200 is charged to the task it corrected, beside its generate.
  assert.match(rows[1] ?? "", /\| 2 \| 2300 \|/);
  assert.match(rows[2] ?? "", /\| 0 \| 1300 \|/);
});

test("the run's verdict is written down, and nothing else is", async () => {
  const green = "test-report-green";
  const red = "test-report-red";
  const greenDirectory = runDirectory(green);
  const redDirectory = runDirectory(red);
  const before = process.exitCode;

  await report(
    stateFor(green, { status: { "a-first": "done", "b-second": "done", "c-third": "done" } }),
  );
  await report(stateFor(red));

  assert.match(await readFile(join(greenDirectory, "summary.md"), "utf8"), /exit 0/);
  assert.match(await readFile(join(redDirectory, "summary.md"), "utf8"), /exit 1/);
  // The node writes the verdict; the CLI is what turns it into a process's exit
  // status. A node that set it would decide the exit code of this test run.
  assert.equal(process.exitCode, before);
});

test("a review that never happened is reported as such, not as a clean one", async () => {
  const runId = "test-report-no-review";
  const directory = runDirectory(runId);

  const result = await report(stateFor(runId, { reviewReport: null }));
  const summary = await readFile(join(directory, "summary.md"), "utf8");

  assert.equal(result.log?.[0]?.event, "wrote");
  assert.match(summary, /No review was recorded/);
  // The failed run still reports, and still says it failed.
  assert.match(summary, /exit 1/);
});

test("a failure carrying its code frame stays readable", async () => {
  const runId = "test-report-multiline";
  const directory = runDirectory(runId);
  const assertion: BuildError = {
    file: "src/__tests__/List.test.tsx",
    line: 18,
    code: "AssertionError",
    message: [
      "expected the heading to contain the item's name",
      "",
      "- Expected",
      "+ Received",
      "",
      "  16 |   render(<List />);",
      "> 18 |   expect(heading).toContain(name);",
    ].join("\n"),
    source: "vitest",
  };

  await report(stateFor(runId, { errors: [assertion] }));
  const summary = await readFile(join(directory, "summary.md"), "utf8");

  // Fenced, not flattened onto one line and not cut: the difference block and
  // the code frame are the part a reader needs.
  assert.match(summary, /```text\n/);
  assert.match(summary, /> 18 \| {3}expect\(heading\)\.toContain\(name\);\n```/);
  assert.match(summary, /\*\*`src\/__tests__\/List\.test\.tsx:18`\*\* — AssertionError · vitest/);
});

test("prints the summary when the artifacts cannot be written", async () => {
  const runId = "test-report-unwritable";
  const directory = runDirectory(runId);
  // A file where the run directory should be, so every write below fails.
  await mkdir(join(REPO_ROOT, "agent", "runs"), { recursive: true });
  await writeFile(directory, "not a directory\n", "utf8");

  const printed: string[] = [];
  const log = console.log;
  console.log = (line: string) => printed.push(line);
  let result;
  try {
    result = await report(stateFor(runId));
  } finally {
    console.log = log;
  }

  assert.equal(result.log?.[0]?.event, "failed");
  assert.match(printed.join("\n"), /# Run test-report-unwritable/);
});
