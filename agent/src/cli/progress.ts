import { taskInFlight } from "../graph/routers.ts";
import { BOLD, VIOLET, duration, paint } from "./ansi.ts";
import type { AgentState } from "../graph/state.ts";
import { totalUsage } from "../llm/ledger.ts";


/**
 * The ids of the tasks being worked on right now.
 *
 * A set of one today, because the queue advances one task at a time — and the
 * single place this file would change if it stopped doing so. The line around
 * it is written for a set, so a level generated at once prints without
 * rewriting the format or the counter.
 */
export function inFlightIds(state: AgentState): string[] {
  const task = taskInFlight(state);
  return task === undefined ? [] : [task.id];
}

/**
 * One line saying where a run is, appended after each superstep's log lines.
 *
 * A run takes around twenty-five minutes, and every figure here — how many
 * tasks are done, which one is in flight, what has been spent — was already in
 * state and shown nowhere until the summary at the end.
 *
 * It appends; it never redraws and never clears. The streamed log is the run's
 * evidence, and a progress line that owns the screen is a progress line that
 * eats it. That is also why the colour is conditional: piped to a file, the
 * output has to stay as plain as it was before this existed.
 *
 * `null` while nothing is planned yet — `prepare` and `plan` have no position
 * to report, and `0/0` is noise, not information.
 */
export function progressLine(
  state: AgentState,
  elapsedMs: number,
  colour: boolean,
): string | null {
  const planned = state.orderedTaskIds.length;
  if (planned === 0) {
    return null;
  }

  // Counted from `status` rather than from the cursor: the cursor is a queue
  // position, and a task the run gave up on has left it behind without being
  // done. `review` writes `pending` for the remediation tasks it queues, which
  // are planned and not yet finished.
  const finished = Object.values(state.status).filter((entry) => entry !== "pending").length;
  const ids = inFlightIds(state);
  const cost = totalUsage(state.usage).costUsd;

  const segments = [
    `progress ${paint(`${finished}/${planned}`, VIOLET, colour)}`,
    ...(ids.length > 0 ? [paint(ids.join(", "), BOLD, colour)] : []),
    duration(elapsedMs),
    `$${cost.toFixed(4)}`,
  ];
  return segments.join(" · ");
}
