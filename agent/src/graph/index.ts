import { END, START, StateGraph } from "@langchain/langgraph";
import { DEFAULT_PROVIDER, createModel, type Provider } from "../llm/factory.ts";
import { plan } from "../nodes/plan.ts";
import { prepare } from "../nodes/prepare.ts";
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
    .addNode("report", report)
    .addEdge(START, "prepare")
    .addConditionalEdges("prepare", routeAfterPrepare, ["plan", "report"])
    .addEdge("plan", "report")
    .addEdge("report", END)
    .compile();
}
