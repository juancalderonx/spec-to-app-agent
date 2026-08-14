import { END, START, StateGraph } from "@langchain/langgraph";
import { DEFAULT_PROVIDER, createModel, type Provider } from "../llm/factory.ts";
import { generate } from "../nodes/generate.ts";
import { order } from "../nodes/order.ts";
import { plan } from "../nodes/plan.ts";
import { prepare } from "../nodes/prepare.ts";
import { routeAfterOrder } from "./routers.ts";
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
 * Supersteps one task is allowed to cost: the `generate` visit it costs today,
 * plus the `validate` visit T-12 adds and the two repair visits T-13 bounds it
 * to. Budgeting for those now costs nothing and spares a later run being cut off
 * mid-queue by a limit nobody thought about.
 */
const STEPS_PER_TASK = 4;

/** `prepare`, `plan`, `order`, `review`, `report`, and one spare. */
const FIXED_STEPS = 6;

/** The longest plan the budget below covers. Named in the message when a run exceeds it. */
export const MAX_PLAN_TASKS = 40;

/**
 * What `invoke` is given instead of the library's default of 25, which the
 * queue outgrows at 21 tasks today and at 11 once `validate` joins the loop.
 * The loop cannot run away on its own — `cursor` only ever increases and
 * `routeAfterGenerate` stops at the end of the queue — so this is the guard on a
 * plan larger than this agent is built for, not on a cycle.
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

/**
 * One task per visit, so the generator comes back until the queue is spent.
 *
 * Temporary in this shape: `generate` advances the cursor because it is
 * currently the only node that finishes a task. T-12 puts `validate` between
 * the two ends of this edge, and T-13's `routeAfterValidate` takes the advance
 * over — the loop stays, its middle grows.
 */
function routeAfterGenerate(state: AgentState): "generate" | "report" {
  return state.cursor < state.orderedTaskIds.length ? "generate" : "report";
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
    .addNode("report", report)
    .addEdge(START, "prepare")
    .addConditionalEdges("prepare", routeAfterPrepare, ["plan", "report"])
    .addEdge("plan", "order")
    .addConditionalEdges("order", routeAfterOrder, ["generate", "report"])
    .addConditionalEdges("generate", routeAfterGenerate, ["generate", "report"])
    .addEdge("report", END)
    .compile();
}
