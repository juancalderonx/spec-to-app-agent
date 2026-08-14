import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import type { AgentState, Task } from "../../graph/state.ts";
import type { CommandResult } from "../../tools/shell.ts";
import { validate, type CommandRunner } from "../validate.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

function fixture(name: string): string {
  return readFileSync(
    join(REPO_ROOT, "agent/src/validate/__tests__/fixtures", `${name}.txt`),
    "utf8",
  );
}

/**
 * A runner in place of the real one, which is how the commands are made to
 * behave on demand: a type error, a failing suite, or a binary that is not
 * there. Throwing is what the real runner does when the command cannot start,
 * and it is not something a test can ask `npm` for.
 */
function runner(answers: Record<string, CommandResult | Error>): {
  run: CommandRunner;
  called: string[];
} {
  const called: string[] = [];
  const run: CommandRunner = (_sandbox, name) => {
    called.push(name);
    const answer = answers[name];
    if (answer === undefined) {
      return Promise.resolve(ok(""));
    }
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  return { run, called };
}

function ok(stdout: string): CommandResult {
  return { code: 0, stdout, stderr: "" };
}

function failing(stdout: string, code = 1): CommandResult {
  return { code, stdout, stderr: "" };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "list-panel",
    description: "Renders the collection it is given.",
    targetPath: "src/components/ListPanel.tsx",
    taskType: "component",
    dependsOn: [],
    acceptance: ["Renders one row per item."],
    ...overrides,
  };
}

/** A workspace of its own per test, so nothing one test writes reaches another. */
async function workspace(runId: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "validate-"));
  after(async () => {
    await rm(directory, { recursive: true, force: true });
    await rm(join(REPO_ROOT, "agent", "runs", runId), { recursive: true, force: true });
  });
  return directory;
}

/** A run whose cursor has already moved past the task that was just written. */
function stateFor(runId: string, outputDir: string, tasks: Task[], cursor = 1): AgentState {
  return {
    runId,
    spec: "One screen listing the collection, with a filter over it.",
    outputDir,
    surface: {},
    projectSurface: {},
    tasks,
    orderedTaskIds: tasks.map((entry) => entry.id),
    cursor,
    attempts: {},
    status: Object.fromEntries(tasks.map((entry) => [entry.id, "pending" as const])),
    errors: [],
    reviewReport: null,
    reviewRounds: 0,
    usage: [],
    log: [],
  };
}

test("reports the type errors of the file just written, naming file and line", async () => {
  const runId = "test-validate-typecheck";
  const outputDir = await workspace(runId);
  const { run, called } = runner({ typecheck: failing(fixture("typecheck-failure"), 2) });

  const result = await validate(stateFor(runId, outputDir, [task(), task({ id: "later" })]), run);

  assert.deepEqual(called, ["typecheck"]);
  assert.equal(result.errors?.length, 4);
  assert.equal(result.errors?.[0]?.file, "src/components/InventoryList.tsx");
  assert.equal(result.errors?.[0]?.line, 18);
  assert.equal(result.errors?.[0]?.source, "tsc");
  // Reporting is the whole job: what to do about it is T-13's.
  assert.equal(result.status, undefined);
});

test("skips the suite for a task that touched no test file, and runs it for one that did", async () => {
  const runId = "test-validate-conditional";
  const outputDir = await workspace(runId);
  const queue = [task(), task({ id: "panel-test", targetPath: "src/__tests__/Panel.test.tsx" })];

  const plain = runner({});
  const skipped = await validate(stateFor(runId, outputDir, queue), plain.run);
  assert.deepEqual(plain.called, ["typecheck"]);
  assert.deepEqual(skipped.errors, []);

  // The task at position 0 wrote a test, so the suite is the signal that matters.
  const tested = runner({});
  await validate(
    stateFor(runId, outputDir, [queue[1] ?? task(), queue[0] ?? task()]),
    tested.run,
  );
  assert.deepEqual(tested.called, ["typecheck", "test"]);
});

test("runs the suite for the last task of the queue whatever it wrote", async () => {
  const runId = "test-validate-last";
  const outputDir = await workspace(runId);
  const { run, called } = runner({ test: failing(fixture("test-failure")) });

  const result = await validate(stateFor(runId, outputDir, [task()]), run);

  assert.deepEqual(called, ["typecheck", "test"]);
  assert.equal(result.errors?.length, 2);
  assert.equal(result.errors?.[0]?.source, "vitest");
  assert.equal(result.errors?.[1]?.line, 21);
});

test("records a command that cannot start instead of coming back clean", async () => {
  const runId = "test-validate-unavailable";
  const outputDir = await workspace(runId);
  const { run } = runner({ typecheck: new Error("spawn npm ENOENT") });

  const result = await validate(stateFor(runId, outputDir, [task()]), run);

  const missing = result.errors?.[0];
  assert.equal(missing?.code, "typecheck-unavailable");
  assert.equal(missing?.source, "runner");
  assert.equal(missing?.file, "src/components/ListPanel.tsx");
  assert.match(missing?.message ?? "", /ENOENT/);
  // A failure that produced no output is still a failure: an empty list here
  // would read as a green run.
  assert.ok((result.errors?.length ?? 0) > 0);
});

test("records a non-zero exit that named no file, carrying the output", async () => {
  const runId = "test-validate-unexplained";
  const outputDir = await workspace(runId);
  const { run } = runner({ typecheck: failing("error TS5083: Cannot read file tsconfig.json.", 1) });

  const result = await validate(stateFor(runId, outputDir, [task()]), run);

  assert.equal(result.errors?.[0]?.code, "typecheck-unexplained");
  assert.match(result.errors?.[0]?.message ?? "", /TS5083/);
});

test("says a test file was written where the runner does not look", async () => {
  const runId = "test-validate-no-test-files";
  const outputDir = await workspace(runId);
  const { run } = runner({ test: failing(fixture("no-test-files")) });
  const misplaced = task({ id: "panel-test", targetPath: "src/tests/Panel.tsx", taskType: "test" });

  const result = await validate(stateFor(runId, outputDir, [misplaced]), run);

  assert.equal(result.errors?.length, 1);
  assert.equal(result.errors?.[0]?.code, "no-test-files");
  assert.equal(result.errors?.[0]?.file, "src/tests/Panel.tsx");
  assert.equal(result.errors?.[0]?.source, "vitest");
});

test("runs both signals when it cannot tell which task finished", async () => {
  const runId = "test-validate-unattributed";
  const outputDir = await workspace(runId);
  const { run, called } = runner({});

  const result = await validate(stateFor(runId, outputDir, [task()], 0), run);

  assert.deepEqual(called, ["typecheck", "test"]);
  assert.equal(result.log?.[0]?.event, "unattributed");
});
