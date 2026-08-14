import { join, resolve } from "node:path";
import type { AgentState, BuildError, LogEntry, Task } from "../graph/state.ts";
import { openSandbox, type Sandbox } from "../tools/fs.ts";
import { runCommand, type CommandResult } from "../tools/shell.ts";
import { openTrace } from "../tools/trace.ts";
import { foundNoTestFiles, parseTests, parseTypecheck } from "../validate/parsers.ts";

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
 * Nothing here repairs, and nothing here settles a task: `status` belongs to
 * T-13, which is what decides whether these errors are worth another attempt.
 * This node reports and stops.
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

  const task = completedTask(state);
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

  return { errors, log };
}

/**
 * The task `generate` has just finished.
 *
 * It advances the cursor on its way out, so the finished task sits one behind —
 * T-13 moves that advance onto the edge leaving this node, and this becomes
 * `orderedTaskIds[cursor]`. The position is checked rather than assumed:
 * arithmetic that is only correct because of where a node sits in the graph is
 * exactly what breaks when the graph changes, and reading past the end here
 * would validate one task's output against another task's expectations without
 * saying so.
 */
function completedTask(state: AgentState): Task | undefined {
  const position = state.cursor - 1;
  if (position < 0 || position >= state.orderedTaskIds.length) {
    return undefined;
  }
  const taskId = state.orderedTaskIds[position];
  return state.tasks.find((candidate) => candidate.id === taskId);
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
