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
 * The failed tasks whose gap is still open: the ones whose file no other task
 * has since written clean.
 *
 * **`status` records what happened to a task; this asks what the run has left
 * unfinished, and the two are different questions.** A task that was given up on
 * stays `failed` — that is history, and the summary's table showing a task failed
 * and a later one green over the same file is the run's own evidence that a
 * failure was recovered from. But a review's remediation task writes the very
 * file the failed task was for, and when that comes back green the requirement
 * is met: the file on disk is right and nothing about the run is still broken.
 * Counting the original failure again is what made the first full run exit 1
 * over a complete, green application, and what made the reviewer report the same
 * two gaps in round 2 about files it could see in the surface.
 *
 * So no status is ever rewritten and the answer is derived instead, in one place,
 * for the two readers that ask it: `runVerdict` for the exit code, and `review`
 * for what the reviewer is told the build left unfinished.
 *
 * Ids rather than tasks, sorted, for the reason `failedTasks` sorts.
 */
export function openGaps(state: AgentState): string[] {
  const targetPaths = new Map(state.tasks.map((task) => [task.id, task.targetPath]));
  const written = new Set(
    state.tasks.filter((task) => state.status[task.id] === "done").map((task) => task.targetPath),
  );
  return failedTasks(state).filter((id) => {
    const path = targetPaths.get(id);
    // A failed id no task claims cannot be shown to have been closed by one.
    return path === undefined || !written.has(path);
  });
}

/**
 * The run's verdict as a process exit code: 0 when nothing is left open, 1
 * otherwise.
 *
 * A function of its own, and exported, because it is the one thing about a run
 * that is easy to get wrong twice. It reads `status`, through `openGaps`, and not
 * only `errors`: `errors` is overwritten by every validation, so it holds what
 * the *last* one found, and a task that failed early is erased the moment a later
 * task validates clean. A run would then exit 0 with its own log naming the
 * failure. `status` is what remembers — and `openGaps` is what asks it the
 * question the exit code is actually about: not whether a task ever failed, but
 * whether any file was left as that failure made it.
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
  return openGaps(state).length === 0 && state.errors.length === 0 ? 0 : 1;
}
