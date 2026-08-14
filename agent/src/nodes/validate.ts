import { join, resolve } from "node:path";
import { attributable, repairable, taskInFlight } from "../graph/routers.ts";
import type { AgentState, BuildError, LogEntry, Task } from "../graph/state.ts";
import { openSandbox, removeFileIn, writeFileIn, type Sandbox } from "../tools/fs.ts";
import { runCommand, type CommandResult } from "../tools/shell.ts";
import { openTrace } from "../tools/trace.ts";
import { foundNoTestFiles, parseTests, parseTypecheck } from "../validate/parsers.ts";
import { snapshotsFor } from "./generate.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

/** A test file as the runner's include patterns see it. */
const TEST_FILE = /(^|\/)__tests__\/|\.(test|spec)\.[cm]?[jt]sx?$/;

/**
 * How a command is run. Defaulted rather than imported at the call site so a
 * test can hand over a runner that fails the way a missing binary does, which is
 * the one path the real one cannot be asked for on demand.
 */
export type CommandRunner = (sandbox: Sandbox, name: string) => Promise<CommandResult>;

/**
 * Runs the project's own validators over what was just written and turns their
 * output into structured errors.
 *
 * The type checker runs on every visit and the test suite when the finished task
 * wrote a test or was the last of the queue: the suite is the slow signal and it
 * only changes when a test file does. Both are needed, because in this project
 * they disagree by construction — a test relying on the runner's globals passes
 * the suite and fails the type check.
 *
 * Nothing here repairs, but this node does settle the task it judged, because
 * it is the only one that runs on every path out of a validation: clean, it
 * writes `status: "done"`; failed on its own file with no repair budget left,
 * it rolls the task back and writes `status: "failed"`. The edge cannot do
 * either — a conditional edge is a pure function from state to a node name —
 * and the predicates it would have to consult are `attributable` and
 * `repairable`, so both ask the same questions of the same functions and cannot
 * disagree.
 *
 * A red validation naming no file this task owns settles nothing and reverts
 * nothing: see `unattributable`.
 *
 * `errors` is overwritten each visit, so what it holds afterwards is the latest
 * validation and not the run's verdict — a failure recorded against an earlier
 * task is gone by the next clean visit. Whoever needs the verdict reads
 * `status`; see `agent/src/cli.ts`.
 */
export async function validate(
  state: AgentState,
  run: CommandRunner = runCommand,
): Promise<Partial<AgentState>> {
  const log: LogEntry[] = [];
  const trace = openTrace(join(REPO_ROOT, "agent", "runs", state.runId, "tools.jsonl"));

  const task = taskInFlight(state);
  // Errors that name no file of their own are attributed to what was just
  // written, which is the file a repair would open.
  const subject = task?.targetPath ?? state.outputDir;
  if (task === undefined) {
    log.push(
      record("unattributed", `no finished task at queue position ${state.cursor - 1}; running both signals`),
    );
  }

  let sandbox: Sandbox;
  try {
    sandbox = await openSandbox(state.outputDir, trace);
  } catch (error) {
    return {
      errors: [synthetic(subject, "workspace-unavailable", message(error))],
      log: [...log, record("failed", message(error))],
    };
  }

  const typecheck = await signal(run, sandbox, "typecheck", parseTypecheck, subject);
  log.push(record("typecheck", typecheck.detail));
  const errors = [...typecheck.errors];

  if (task === undefined || task.taskType === "test" || TEST_FILE.test(task.targetPath) || isLast(state)) {
    const tests = await signal(
      run,
      sandbox,
      "test",
      (output) => parseTestOutput(output, subject),
      subject,
    );
    log.push(record("tests", tests.detail));
    errors.push(...tests.errors);
  } else {
    log.push(record("tests-skipped", `${task.id} touched no test file and others remain queued`));
  }

  if (task === undefined) {
    return { errors, log };
  }
  if (errors.length === 0) {
    return { errors, status: { ...state.status, [task.id]: "done" }, log };
  }
  if (!attributable({ ...state, errors })) {
    return { errors, log: [...log, record("not-attributable", unattributable(task, errors))] };
  }
  if (repairable(state)) {
    // Not the last word: the edge is about to send this to `repair`, and the
    // task keeps its `pending` status until one of us runs out of budget.
    return { errors, log };
  }
  return abandon(state, task, sandbox, errors, log);
}

/**
 * What a task is told when its validation is red and no error names its file.
 *
 * It is neither settled nor rolled back, and it spends no repair budget: the
 * failure is real but it is not this task's to answer, and reverting a file that
 * nothing complained about would destroy correct work and blame the wrong task
 * for the breakage. `status` stays `pending`, which is the honest reading — the
 * task was attempted and its validation never came back clean about anything it
 * owns — and `errors` is kept, because unlike a rollback nothing here has made
 * them obsolete: the workspace really is broken, by a file with another owner.
 *
 * The run therefore still exits non-zero through `runVerdict`, which counts
 * errors no task owns, and the queue carries on. This is the attribution gap the
 * conditional test rule creates, handled where it surfaces.
 */
function unattributable(task: Task, errors: BuildError[]): string {
  const elsewhere = [...new Set(errors.map((error) => error.file))].sort();
  return (
    `${task.id} owns ${task.targetPath}, which no error names · ` +
    `the failure is in ${elsewhere.join(", ")} · ` +
    `advancing without repair: this task cannot rewrite those files`
  );
}

/**
 * Puts a task that ran out of repair budget back where it was, and says so.
 *
 * `errors` comes back **empty**, which is the part worth arguing. It describes
 * a file that no longer exists in the shape that produced them — the rollback
 * has just undone it — so carrying them forward would claim a broken workspace
 * that was repaired a line ago, and would count the same failure twice in
 * `runVerdict`, which already reads `status`. What survives is the log entry
 * below, which names the task and the error it died on, and `status`, which is
 * what the exit code and T-14's summary read.
 *
 * A rollback that itself fails is written down and the task is still marked
 * failed. The alternative is throwing out of a node whose entire purpose is
 * that one bad task does not end the run.
 */
async function abandon(
  state: AgentState,
  task: Task,
  sandbox: Sandbox,
  errors: BuildError[],
  log: LogEntry[],
): Promise<Partial<AgentState>> {
  const spent = state.attempts[task.id] ?? 0;
  const first = errors[0];
  const cause = first === undefined ? "no error was named" : `${first.code}: ${first.message}`;

  let outcome: string;
  try {
    const restored = await rollBack(sandbox, state.runId, task.id);
    outcome = `${restored} files restored`;
  } catch (error) {
    outcome = `rollback failed: ${message(error)}`;
  }

  return {
    errors: [],
    status: { ...state.status, [task.id]: "failed" },
    log: [
      ...log,
      record(
        "abandoned",
        `${task.id} after ${spent} repairs · ${outcome} · last error · ${cause}`,
      ),
    ],
  };
}

/**
 * Undoes every write a task performed, newest first, and answers how many.
 *
 * A snapshot holding `null` is a file the task created, so putting it back means
 * deleting it. Both operations go through the sandbox, which is what keeps the
 * one destructive path in the agent behind the same containment check as the
 * writes.
 */
async function rollBack(sandbox: Sandbox, runId: string, taskId: string): Promise<number> {
  const taken = snapshotsFor(runId).get(taskId) ?? [];
  for (const snapshot of [...taken].reverse()) {
    if (snapshot.contents === null) {
      await removeFileIn(sandbox, snapshot.path);
    } else {
      await writeFileIn(sandbox, snapshot.path, snapshot.contents);
    }
  }
  return taken.length;
}

/** Whether the queue has nothing left after the task that just finished. */
function isLast(state: AgentState): boolean {
  return state.cursor >= state.orderedTaskIds.length;
}

/**
 * One validation signal: run the command, read its output, and never come back
 * empty from a failure.
 *
 * A command that exits non-zero with nothing parseable is the dangerous case —
 * it looks exactly like success to a caller that only counts errors — so it
 * produces a synthetic one carrying the output instead.
 */
async function signal(
  run: CommandRunner,
  sandbox: Sandbox,
  name: "typecheck" | "test",
  parse: (output: string) => BuildError[],
  subject: string,
): Promise<{ errors: BuildError[]; detail: string }> {
  let result: CommandResult;
  try {
    result = await run(sandbox, name);
  } catch (error) {
    return {
      errors: [
        synthetic(subject, `${name}-unavailable`, `npm run ${name} did not run: ${message(error)}`),
      ],
      detail: `did not run: ${message(error)}`,
    };
  }

  const errors = parse(`${result.stdout}\n${result.stderr}`);
  if (result.code !== 0 && errors.length === 0) {
    return {
      errors: [
        synthetic(
          subject,
          `${name}-unexplained`,
          `npm run ${name} exited ${result.code} without naming a file:\n` +
            `${result.stdout}${result.stderr}`,
        ),
      ],
      detail: `exit ${result.code}, nothing parseable`,
    };
  }
  return { errors, detail: `exit ${result.code} · ${errors.length} errors` };
}

/**
 * Test output to errors, with the empty run told apart from the failing one.
 *
 * The runner exits non-zero for both. A test task that wrote to a path the
 * include patterns do not match leaves a suite with nothing in it, and the
 * repair that fixes it moves the file — nothing about the assertions is wrong.
 */
function parseTestOutput(output: string, subject: string): BuildError[] {
  if (foundNoTestFiles(output)) {
    return [
      synthetic(
        subject,
        "no-test-files",
        "The test runner matched no files. A test written outside the patterns it " +
          "includes never runs, however correct it is.",
        "vitest",
      ),
    ];
  }
  return parseTests(output);
}

/** An error this code raised, as opposed to one a validator reported. */
function synthetic(
  file: string,
  code: string,
  detail: string,
  source: BuildError["source"] = "runner",
): BuildError {
  return { file, code, message: detail, source };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function record(event: string, detail: string): LogEntry {
  return { node: "validate", event, detail };
}
