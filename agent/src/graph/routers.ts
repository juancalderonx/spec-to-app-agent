import type { AgentState } from "./state.ts";

/**
 * An empty order is the only outcome `order` can leave behind when the run
 * cannot proceed: a cycle, a dependency on an unknown id and a plan with no
 * tasks all end there, and each has already been recorded by the node. So the
 * edge asks one question rather than re-deriving three.
 */
export function routeAfterOrder(state: AgentState): "generate" | "report" {
  return state.orderedTaskIds.length === 0 ? "report" : "generate";
}
