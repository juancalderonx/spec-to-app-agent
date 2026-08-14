import type { AgentState, Task } from "./state.ts";

/**
 * Repair visits one task is allowed before the run gives up on it.
 *
 * Two, for the same reason every other bounded retry here is two: the first
 * attempt is the one that gets to read what went wrong, and a third is almost
 * always the second one again at full price.
 */
export const MAX_REPAIRS_PER_TASK = 2;

/**
 * Repair visits the whole run is allowed, across every task.
 *
 * The per-task ceiling alone bounds a task; it does not bound a *run* whose
 * every task fails, which costs `tasks × MAX_REPAIRS_PER_TASK` paid calls to
 * arrive at an application that was never going to build. Past roughly this
 * many repairs the run is not converging, and the remaining budget buys noise.
 * The tasks after it still get generated and validated — they are just no
 * longer repaired.
 */
export const MAX_REPAIRS_PER_RUN = 10;

/**
 * An empty order is the only outcome `order` can leave behind when the run
 * cannot proceed: a cycle, a dependency on an unknown id and a plan with no
 * tasks all end there, and each has already been recorded by the node. So the
 * edge asks one question rather than re-deriving three.
 */
export function routeAfterOrder(state: AgentState): "generate" | "report" {
  return state.orderedTaskIds.length === 0 ? "report" : "generate";
}

/**
 * The task `generate` has just written: the one `validate` judges and `repair`
 * rewrites.
 *
 * It sits one behind the cursor because `generate` advances on its way out. The
 * position is checked rather than assumed: arithmetic that is only correct
 * because of where a node sits in the graph is exactly what breaks when the
 * graph changes.
 */
export function taskInFlight(state: AgentState): Task | undefined {
  const position = state.cursor - 1;
  if (position < 0 || position >= state.orderedTaskIds.length) {
    return undefined;
  }
  const taskId = state.orderedTaskIds[position];
  return state.tasks.find((candidate) => candidate.id === taskId);
}

/**
 * Whether any current error names the file the task in flight owns.
 *
 * `repair` may rewrite exactly one file, the one this task owns. So a
 * validation whose every error lands somewhere else describes a problem this
 * task **cannot** fix: the node would read its file, send a failure about a
 * different one, and be asked to correct code it was never shown. Two attempts
 * later the task would be rolled back and marked failed for someone else's
 * breakage, and the broken file would never have been touched.
 *
 * That is not the tail of the distribution. Any task of type `test` runs the
 * whole suite, and the whole suite includes every earlier task's tests, so a
 * regression anywhere surfaces on a task that did not cause it — the attribution
 * gap the `validate` section of the architecture describes.
 *
 * One error naming the file is enough. The rest travel with it as context,
 * because a task legitimately breaks files it does not own: change an export and
 * the compiler reports the importer. Filtering those out of the payload would
 * hide the actual symptom of the change being repaired.
 *
 * The comparison is a plain string equality, which holds because both parsers
 * emit paths relative to the project root, in the same shape a task's
 * `targetPath` is written in.
 */
export function attributable(state: AgentState): boolean {
  const task = taskInFlight(state);
  if (task === undefined) {
    return false;
  }
  return state.errors.some((error) => error.file === task.targetPath);
}

/** Repair visits this run has already spent. `attempts` is per task; this is the run. */
export function repairsSpent(state: AgentState): number {
  return Object.values(state.attempts).reduce((total, spent) => total + spent, 0);
}

/**
 * Whether the task in flight may be sent to `repair` once more.
 *
 * The single home of the retry policy. `routeAfterValidate` asks it to decide
 * where to go, and `validate` asks it to decide whether the errors it just
 * found are this task's last word — so the edge and the node cannot disagree
 * about a task's fate, which is the way a rollback goes missing or happens
 * twice.
 *
 * A visit with no task in flight is not repairable: there is no file to send
 * and no id to charge the attempt to.
 */
export function repairable(state: AgentState): boolean {
  const task = taskInFlight(state);
  if (task === undefined) {
    return false;
  }
  return (
    (state.attempts[task.id] ?? 0) < MAX_REPAIRS_PER_TASK &&
    repairsSpent(state) < MAX_REPAIRS_PER_RUN
  );
}

/**
 * The repair loop, the queue advance and the degradation path, in four
 * branches:
 *
 * 1. errors the task could fix, and the budget to try → `repair`
 * 2. errors it cannot fix, or no budget left → on to the next task; `validate`
 *    has already settled the task, rolling it back only if the failure was its
 *    own
 * 3. clean, and the queue has more → the next task
 * 4. clean, and the queue is empty → the end of the run
 *
 * Branches 2 and 3 share a destination and not a cause, which is why the
 * degradation is not visible here: **a conditional edge in this library is a
 * pure function from state to a node name.** It cannot write state and it
 * cannot touch the disk, so rolling back and marking the task failed belong to
 * `validate`, the node that judged them, and advancing the cursor stays in
 * `generate`, the node that consumed it. What lives here is the decision alone.
 *
 * T-14 replaces branch 4's `report` with `review`.
 */
export function routeAfterValidate(state: AgentState): "repair" | "generate" | "report" {
  if (state.errors.length > 0 && attributable(state) && repairable(state)) {
    return "repair";
  }
  return state.cursor < state.orderedTaskIds.length ? "generate" : "report";
}
