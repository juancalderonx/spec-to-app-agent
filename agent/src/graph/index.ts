import { END, START, StateGraph } from "@langchain/langgraph";
import { DEFAULT_PROVIDER, createModel, type Provider } from "../llm/factory.ts";
import { generate } from "../nodes/generate.ts";
import { order } from "../nodes/order.ts";
import { plan } from "../nodes/plan.ts";
import { prepare } from "../nodes/prepare.ts";
import { repair } from "../nodes/repair.ts";
import { validate } from "../nodes/validate.ts";
import {
  MAX_REPAIRS_PER_TASK,
  routeAfterOrder,
  routeAfterValidate,
} from "./routers.ts";
import { AgentStateAnnotation, type AgentState } from "./state.ts";

/**
 * What the CLI resolved, handed to the nodes that call a provider. It is not
 * part of the shared state: it is the same for every node of a run and nothing
 * writes back to it.
 */
export interface RunOptions {
  provider: Provider;
  /** From `--model`. Undefined leaves every role on its own default. */
  model: string | undefined;
}

const DEFAULT_RUN_OPTIONS: RunOptions = { provider: DEFAULT_PROVIDER, model: undefined };

/**
 * Supersteps one task is allowed to cost, in the worst case: one `generate`,
 * then `R` repairs, and a `validate` after each of them as well as after the
 * generate.
 *
 *     1 + R + (1 + R) = 2 + 2R,  R = MAX_REPAIRS_PER_TASK
 *
 * The formula rather than the number it evaluates to, so that raising a ceiling
 * raises the budget with it instead of silently cutting a run off mid-queue.
 *
 * This over-budgets on purpose. `MAX_REPAIRS_PER_RUN` caps repairs across the
 * whole run well below `tasks × R`, so no real run can reach `tasks × (2 + 2R)`
 * — but a budget is the wrong place to bet on that, since being wrong costs a
 * whole run and being generous costs nothing.
 */
const STEPS_PER_TASK = 2 + 2 * MAX_REPAIRS_PER_TASK;

/** `prepare`, `plan`, `order`, `review`, `report`, and one spare. */
const FIXED_STEPS = 6;

/** The longest plan the budget below covers. Named in the message when a run exceeds it. */
export const MAX_PLAN_TASKS = 40;

/**
 * What `invoke` is given instead of the library's default of 25, which the
 * queue outgrows within a handful of tasks now that each one costs a `generate`,
 * a `validate` and possibly a repair round. The loop cannot run away on its own
 * — `cursor` only ever increases, every repair charges an attempt against two
 * ceilings, and `routeAfterValidate` stops at the end of the queue — so this is
 * the guard on a plan larger than this agent is built for, not on a cycle.
 */
export const RECURSION_LIMIT = FIXED_STEPS + MAX_PLAN_TASKS * STEPS_PER_TASK;

// Placeholder. T-14 replaces `report` with the artifact writer. It carries the
// name the architecture's graph uses, so the rendered diagram never has to be
// relabelled.

function report(state: AgentState) {
  return {
    log: [
      {
        node: "report",
        event: "placeholder",
        detail: `would write artifacts for run ${state.runId}`,
      },
    ],
  };
}

/** A workspace that did not set up is not worth spending a planner call on. */
function routeAfterPrepare(state: AgentState): "plan" | "report" {
  return state.errors.length > 0 ? "report" : "plan";
}

export function buildGraph(options: RunOptions = DEFAULT_RUN_OPTIONS) {
  return new StateGraph(AgentStateAnnotation)
    .addNode("prepare", prepare)
    .addNode("plan", (state) => {
      // Built per visit rather than once at compile time: rendering the diagram
      // must not need a credential.
      const { provider, model } = options;
      return plan(state, createModel({ provider, role: "planner", model }));
    })
    .addNode("order", order)
    .addNode("generate", (state) => {
      const { provider, model } = options;
      return generate(state, createModel({ provider, role: "coder", model }));
    })
    // Called with the state alone: the node's second parameter is the command
    // runner its tests replace, and the graph would otherwise hand it a config.
    .addNode("validate", (state) => validate(state))
    .addNode("repair", (state) => {
      // The coder role, deliberately: the file being corrected is one this same
      // role wrote, against the same standing constraints and the same prefix.
      const { provider, model } = options;
      return repair(state, createModel({ provider, role: "coder", model }));
    })
    .addNode("report", report)
    .addEdge(START, "prepare")
    .addConditionalEdges("prepare", routeAfterPrepare, ["plan", "report"])
    .addEdge("plan", "order")
    .addConditionalEdges("order", routeAfterOrder, ["generate", "report"])
    .addEdge("generate", "validate")
    .addConditionalEdges("validate", routeAfterValidate, ["repair", "generate", "report"])
    .addEdge("repair", "validate")
    .addEdge("report", END)
    .compile();
}
