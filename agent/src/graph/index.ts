import { END, START, StateGraph } from "@langchain/langgraph";
import { AgentStateAnnotation, type AgentState } from "./state.ts";

// Placeholders. T-06 replaces `prepare` with the real workspace setup and T-14
// replaces `report` with the artifact writer. They carry the names the
// architecture's graph uses, so the rendered diagram never has to be relabelled.

function prepare(state: AgentState) {
  return {
    log: [
      {
        node: "prepare",
        event: "placeholder",
        detail: `would prepare ${state.outputDir} from a ${state.spec.length}-character spec`,
      },
    ],
  };
}

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
