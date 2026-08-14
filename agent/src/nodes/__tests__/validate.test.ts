import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { MAX_REPAIRS_PER_TASK } from "../../graph/routers.ts";
import type { AgentState, SurfaceManifest, Task, UsageEntry } from "../../graph/state.ts";
import { runVerdict } from "../../graph/verdict.ts";
import type { ModelClient } from "../../llm/factory.ts";
import { parseSurface } from "../../surface/manifest.ts";
import type { CommandResult } from "../../tools/shell.ts";
import { generate } from "../generate.ts";
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
  // The task keeps its `pending` status: it still has repair budget, so these
  // errors are not its last word.
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

/**
 * The defect this ticket exists for. `taskType` is the planner's label for what
 * a task is about; whether the runner collects the file is a fact about the path
 * it wrote. A shared render helper is reasonably typed `test` and is collected by
 * nothing, so a suite run for it answers `no-test-files` — and the task spends
 * its whole repair budget rewriting a file that type-checks clean, which is how
 * the first full run lost its fifth task of fifteen.
 */
test("decides the suite from the path the task wrote, not from its type", async () => {
  const runId = "test-validate-type-is-not-a-path";
  const outputDir = await workspace(runId);
  const helper = task({
    id: "render-helper",
    targetPath: "src/test-utils/renderWithProviders.tsx",
    taskType: "test",
  });

  const uncollected = runner({ test: failing(fixture("no-test-files")) });
  const skipped = await validate(
    stateFor(runId, outputDir, [helper, task({ id: "later" })]),
    uncollected.run,
  );

  assert.deepEqual(uncollected.called, ["typecheck"]);
  assert.deepEqual(skipped.errors, []);
  assert.equal(skipped.status?.["render-helper"], "done");

  // And the other half: a file the include patterns do match is exactly when the
  // slow signal is worth paying for.
  const collected = runner({});
  await validate(
    stateFor(
      runId,
      outputDir,
      [task({ id: "panel-test", targetPath: "src/components/__tests__/Panel.test.tsx" }), helper],
    ),
    collected.run,
  );

  assert.deepEqual(collected.called, ["typecheck", "test"]);
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

test("marks a task done when both signals come back clean", async () => {
  const runId = "test-validate-done";
  const outputDir = await workspace(runId);
  const { run } = runner({});

  const result = await validate(stateFor(runId, outputDir, [task()]), run);

  assert.deepEqual(result.errors, []);
  assert.equal(result.status?.["list-panel"], "done");
});

/**
 * The mirror of the failure this ticket is about, and the one that reads as
 * green: a task whose generation never produced a file has nothing for the type
 * checker to reject and nothing for the suite to run, so both signals come back
 * clean about work that was never done. Settling on that would take the task out
 * of `openGaps` and end the run at 0 over a file that does not exist.
 */
test("does not mark done a task generate gave up on, however clean the validation", async () => {
  const runId = "test-validate-generate-failed";
  const outputDir = await workspace(runId);
  const { run } = runner({});
  const abandoned = { ...stateFor(runId, outputDir, [task()]), status: { "list-panel": "failed" as const } };

  const result = await validate(abandoned, run);

  assert.deepEqual(result.errors, []);
  // No status written at all, so the one `generate` recorded stands.
  assert.equal(result.status, undefined);
  assert.equal(result.log?.at(-1)?.event, "stays-failed");
  assert.equal(runVerdict({ ...abandoned, ...result }), 1);
});

/**
 * The rollback is the only destructive path in the agent and it runs without
 * asking anyone, so it is worth pinning from both sides: that it happens when
 * the budget is gone, and — the direction that fails silently — that it does
 * not happen a moment before.
 *
 * `generate` runs first rather than the snapshot being planted, because the
 * snapshot is its private bookkeeping and a test that reached around it would
 * keep passing against a node that had stopped taking them.
 */
const OVERWRITTEN = "export default function ListPanel() {\n  return null;\n}\n";

/**
 * What the project shipped, exporting under a *name* where the generated file
 * exports a default.
 *
 * The difference is what lets a test tell a restored manifest entry from the one
 * the task left behind: both files would otherwise parse to the same exports,
 * and an assertion neither version can fail proves nothing about the rollback.
 */
const SHIPPED = "export function ListPanel() {\n  return unchanged;\n}\n";

/**
 * Type-checker output blaming the file the task in flight owns.
 *
 * Written out rather than taken from the fixtures, which name a file of their
 * own: a rollback is only ever warranted by a failure in the task's own file,
 * so a test of one has to produce that failure and not merely a red exit.
 */
function ownFailure(): CommandResult {
  return failing(
    "src/components/ListPanel.tsx(2,10): error TS2345: " +
      "Argument of type 'string' is not assignable to parameter of type 'Item'.",
    2,
  );
}

/** No provider is reached: `generate` is here to take the snapshot, not to think. */
function coder(): ModelClient {
  const spent: UsageEntry = {
    node: "generate",
    role: "coder",
    model: "stub",
    inputTokens: 0,
    cachedReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  };
  return {
    modelId: "stub",
    cacheable: (text) => ["human", text],
    invoke: () => Promise.reject(new Error("unused")),
    invokeStructured: () => Promise.resolve({ value: { contents: OVERWRITTEN }, usage: spent }),
  };
}

/**
 * A run whose one task has overwritten a file the project shipped.
 *
 * The surface it carries is the one `generate` returned, which is what the graph
 * hands the next node: it describes the *written* file, so a test can ask what
 * the rollback did to it.
 */
async function afterOverwriting(runId: string, outputDir: string): Promise<AgentState> {
  await mkdir(join(outputDir, "src/components"), { recursive: true });
  await writeFile(join(outputDir, "src/components/ListPanel.tsx"), SHIPPED, "utf8");

  const before = stateFor(runId, outputDir, [task()], 0);
  const shipped = { "src/components/ListPanel.tsx": parseSurface("ListPanel.tsx", SHIPPED) };
  const written = await generate({ ...before, surface: shipped }, coder());

  return { ...before, surface: written.surface ?? shipped, cursor: written.cursor ?? 1 };
}

/** The names one file exposes, as the manifest has them. */
function exportsOf(surface: SurfaceManifest | undefined, path: string): string[] | undefined {
  return surface?.[path]?.exports.map((entry) => entry.name);
}

test("leaves the disk alone while the failing task still has repair budget", async () => {
  const runId = "test-validate-no-rollback";
  const outputDir = await workspace(runId);
  const state = await afterOverwriting(runId, outputDir);
  const { run } = runner({ typecheck: ownFailure() });

  // One attempt short of the ceiling: the last visit on which reverting would
  // be wrong, which is the visit an off-by-one gets wrong.
  const result = await validate(
    { ...state, attempts: { "list-panel": MAX_REPAIRS_PER_TASK - 1 } },
    run,
  );

  // Not settled, and above all not reverted: the repair has not happened yet.
  assert.equal(
    await readFile(join(outputDir, "src/components/ListPanel.tsx"), "utf8"),
    OVERWRITTEN,
  );
  assert.equal(result.status, undefined);
  assert.ok((result.errors?.length ?? 0) > 0);
  // The manifest is left alone too: it describes the file that is on disk.
  assert.equal(result.surface, undefined);
});

test("restores what the task overwrote once its repair budget is spent", async () => {
  const runId = "test-validate-rollback";
  const outputDir = await workspace(runId);
  const state = await afterOverwriting(runId, outputDir);
  const { run } = runner({ typecheck: ownFailure() });

  const result = await validate(
    { ...state, attempts: { "list-panel": MAX_REPAIRS_PER_TASK } },
    run,
  );

  assert.equal(await readFile(join(outputDir, "src/components/ListPanel.tsx"), "utf8"), SHIPPED);
  assert.equal(result.status?.["list-panel"], "failed");
  // The manifest follows the disk: it describes the file that was put back, and
  // no longer the one the task wrote. A later task reads this to decide what the
  // project holds, and `generate` reads it to decide what needs snapshotting.
  assert.deepEqual(exportsOf(result.surface, "src/components/ListPanel.tsx"), ["ListPanel"]);
  // Cleared: they describe a file that has just been put back. The cause
  // survives in the log, which is where a reader goes looking for it.
  assert.deepEqual(result.errors, []);
  const abandoned = result.log?.find((entry) => entry.event === "abandoned");
  assert.match(abandoned?.detail ?? "", /list-panel/);
  assert.match(abandoned?.detail ?? "", /TS2345/);
});

/**
 * The failure this ticket nearly shipped. A task of type `test` runs the whole
 * suite, the suite carries every earlier task's tests, and a regression one task
 * caused comes back red on a later one. Nothing in that error names the file the
 * later task owns, so no repair it could attempt would reach it — and the task
 * would be reverted and marked failed for breakage it never caused.
 */
test("neither reverts nor blames a task whose failure names no file it owns", async () => {
  const runId = "test-validate-not-attributable";
  const outputDir = await workspace(runId);
  const state = await afterOverwriting(runId, outputDir);
  // A red suite, and every failure belongs to a file this task does not own.
  const { run } = runner({ test: failing(fixture("test-failure")) });

  const result = await validate(
    { ...state, attempts: { "list-panel": MAX_REPAIRS_PER_TASK } },
    run,
  );

  // Budget spent, and still nothing is destroyed: the file this task wrote
  // stands, and the task is not accused of a failure it cannot answer.
  assert.equal(
    await readFile(join(outputDir, "src/components/ListPanel.tsx"), "utf8"),
    OVERWRITTEN,
  );
  assert.equal(result.status, undefined);
  // The errors survive: unlike a rollback, nothing here made them obsolete —
  // the workspace really is broken, by a file with another owner.
  assert.ok((result.errors?.length ?? 0) > 0);
  const skipped = result.log?.find((entry) => entry.event === "not-attributable");
  assert.match(skipped?.detail ?? "", /InventoryList\.test\.tsx/);
});

/**
 * The second half of the same invariant, and the one that shipped broken: the
 * deletion has to reach the manifest as well as the disk.
 *
 * A manifest still listing a file the rollback deleted is what the review's
 * remediation task walked into in the first full run — it targets the abandoned
 * file, `generate` reads the manifest, decides the file exists and needs
 * snapshotting, and the read fails with `ENOENT` before a token is spent.
 */
test("deletes a file the failed task created, rather than leaving it behind", async () => {
  const runId = "test-validate-rollback-create";
  const outputDir = await workspace(runId);
  const created = join(outputDir, "src/components/ListPanel.tsx");

  // No surface entry, so the file did not exist before: the snapshot holds `null`.
  const before = stateFor(runId, outputDir, [task()], 0);
  const written = await generate(before, coder());
  assert.equal(existsSync(created), true);
  assert.deepEqual(exportsOf(written.surface, "src/components/ListPanel.tsx"), ["default"]);

  const { run } = runner({ typecheck: ownFailure() });
  const result = await validate(
    {
      ...before,
      surface: written.surface ?? {},
      cursor: written.cursor ?? 1,
      attempts: { "list-panel": MAX_REPAIRS_PER_TASK },
    },
    run,
  );

  assert.equal(existsSync(created), false);
  assert.equal(result.status?.["list-panel"], "failed");
  assert.equal(result.surface?.["src/components/ListPanel.tsx"], undefined);
});
