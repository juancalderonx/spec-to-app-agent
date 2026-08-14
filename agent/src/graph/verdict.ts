import type { AgentState } from "./state.ts";

/**
 * The tasks the run gave up on, named so a reader is told which ones.
 *
 * Sorted rather than left in insertion order: the message it produces ends up in
 * a run's output, and an artifact that reorders itself between two runs of the
 * same plan is one nobody can diff.
 */
export function failedTasks(state: AgentState): string[] {
  return Object.keys(state.status)
    .filter((id) => state.status[id] === "failed")
    .sort();
}

/**
 * The run's verdict as a process exit code: 0 when nothing failed, 1 otherwise.
 *
 * A function of its own, and exported, because it is the one thing about a run
 * that is easy to get wrong twice. It reads `status` and not only `errors`:
 * `errors` is overwritten by every validation, so it holds what the *last* one
 * found, and a task that failed early is erased the moment a later task
 * validates clean. A run would then exit 0 with its own log naming the failure.
 * `status` is what remembers.
 *
 * `errors` still counts, for the failures no task owns: a workspace that did not
 * install, a plan that could not be ordered. Those end the run before `status`
 * has anything in it.
 *
 * Two callers, one rule: the CLI, which turns it into the process's exit code,
 * and `report`, which writes it into `summary.md`. The node does not set the
 * code itself — the graph is run by the test suite too, and a node that writes
 * `process.exitCode` would decide the exit status of whatever ran it.
 */
export function runVerdict(state: AgentState): number {
  return failedTasks(state).length === 0 && state.errors.length === 0 ? 0 : 1;
}
