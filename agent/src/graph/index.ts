import { END, START, StateGraph } from "@langchain/langgraph";
import { prepare } from "../nodes/prepare.ts";
import { AgentStateAnnotation, type AgentState } from "./state.ts";

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

export function buildGraph() {
  return new StateGraph(AgentStateAnnotation)
    .addNode("prepare", prepare)
    .addNode("report", report)
    .addEdge(START, "prepare")
    .addEdge("prepare", "report")
    .addEdge("report", END)
    .compile();
}
