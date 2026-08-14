import type { AgentState, LogEntry, Task, TaskStatus } from "../graph/state.ts";

type Sorted =
  | { ok: true; orderedTaskIds: string[] }
  | { ok: false; reason: string };

/**
 * Computes the execution order from the plan's dependency edges.
 *
 * Ordering is a guarantee this code owns rather than a judgement asked of the
 * model: Kahn's algorithm cannot return a cyclic order, and a model cannot
 * promise that. The model still decides the edges, which is the semantic part.
 *
 * A malformed plan is recorded rather than thrown, like `prepare` and `plan`:
 * `orderedTaskIds` stays empty, `routeAfterOrder` sends the run to `report`,
 * and the run ends with a diagnosable artifact instead of a stack trace.
 */
export function order(state: AgentState): Partial<AgentState> {
  const sorted = sortTasks(state.tasks);
  if (!sorted.ok) {
    return {
      log: [record("failed", sorted.reason)],
      errors: [
        {
          file: state.outputDir,
          line: 0,
          code: "order-failed",
          message: sorted.reason,
          source: "runner",
        },
      ],
    };
  }

  const status: Record<string, TaskStatus> = {};
  for (const id of sorted.orderedTaskIds) {
    status[id] = "pending";
  }

  return {
    orderedTaskIds: sorted.orderedTaskIds,
    status,
    cursor: 0,
    log: [
      record(
        "ordered",
        sorted.orderedTaskIds.length === 0
          ? "the plan holds no tasks"
          : sorted.orderedTaskIds.join(" -> "),
      ),
    ],
  };
}

/**
 * Kahn's algorithm over the `dependsOn` edges, with ties broken by task id.
 *
 * Without that tie-break the output depends on the order the planner happened
 * to emit the tasks in, so the same plan could execute two different ways.
 */
function sortTasks(tasks: Task[]): Sorted {
  const ids = new Set(tasks.map((task) => task.id));
  const dangling = tasks.flatMap((task) =>
    task.dependsOn
      .filter((dependency) => !ids.has(dependency))
      .map((dependency) => `"${task.id}" depends on "${dependency}"`),
  );
  if (dangling.length > 0) {
    return {
      ok: false,
      reason: `The plan depends on ids it does not define: ${dangling.join(", ")}.`,
    };
  }

  // Each entry is a task and the dependencies it is still waiting on. Scanning
  // the whole map for the next ready task is quadratic in the number of tasks,
  // which a plan of a few dozen entries does not notice.
  const waitingOn = new Map(tasks.map((task) => [task.id, new Set(task.dependsOn)]));
  const orderedTaskIds: string[] = [];

  while (waitingOn.size > 0) {
    const ready = [...waitingOn]
      .filter(([, dependencies]) => dependencies.size === 0)
      .map(([id]) => id)
      .sort();
    const next = ready[0];
    if (next === undefined) {
      const stuck = [...waitingOn.keys()].sort().join(", ");
      return {
        ok: false,
        reason: `The dependencies close a cycle: none of ${stuck} can run first.`,
      };
    }

    orderedTaskIds.push(next);
    waitingOn.delete(next);
    for (const dependencies of waitingOn.values()) {
      dependencies.delete(next);
    }
  }

  return { ok: true, orderedTaskIds };
}

function record(event: string, detail: string): LogEntry {
  return { node: "order", event, detail };
}
