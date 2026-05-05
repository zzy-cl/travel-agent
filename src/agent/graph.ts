import { END, START, StateGraph, MemorySaver } from "@langchain/langgraph";
import { AgentState, type AgentStateType } from "./state";
import { infoCollector } from "./nodes/info-collector";
import { callPlanAgent } from "./nodes/plan-agent";

// ── Router: single entry point based on phase ──
function routeByPhase(
  state: AgentStateType,
): "info_collector" | "plan_agent" | "save" | typeof END {
  switch (state.phase) {
    case "info_gathering":
      return "info_collector";
    case "planning":
    case "refinement":
      return "plan_agent";
    case "confirming": {
      if (!state.planMarkdown) return "plan_agent"; // No plan yet, regenerate
      const lastHuman = [...state.messages]
        .reverse()
        .find((m) => m.getType() === "human");
      const text =
        lastHuman && typeof lastHuman.content === "string"
          ? lastHuman.content
          : "";
      if (/^(没问题|确认|确定|好的|可以|OK|ok|行|嗯|对|保存)\b/.test(text)) {
        return "save";
      }
      return "plan_agent"; // User wants modifications
    }
    default:
      return END;
  }
}

// ── Save: mark done ──
function saveNode(): Partial<AgentStateType> {
  return { phase: "done" };
}

// ── Build graph ──
const workflow = new StateGraph(AgentState)
  // 3 nodes
  .addNode("info_collector", infoCollector)
  .addNode("plan_agent", callPlanAgent)
  .addNode("save", saveNode)

  // START → router → agent
  .addConditionalEdges(START, routeByPhase)

  // After each agent: end (interrupts handled via interrupt() in nodes)
  .addEdge("info_collector", END)
  .addEdge("plan_agent", END)

  // Save → end
  .addEdge("save", END);

const checkpointer = new MemorySaver();

export const travelAgent = workflow.compile({ checkpointer });
