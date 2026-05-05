import { END, START, StateGraph, MemorySaver } from "@langchain/langgraph";
import { AgentState, type AgentStateType } from "./state";
import { infoCollector } from "./nodes/info-collector";
import { callPlanAgent } from "./nodes/plan-agent";
import { exportNode } from "./nodes/export";

// ── Router: single entry point based on tripStatus and phase ──
function routeByIntent(
  state: AgentStateType,
): "info_collector" | "plan_agent" | "export" | "save" | typeof END {
  // Ongoing trips always go to plan_agent (real-time assistance)
  if (state.tripStatus === "ongoing") {
    return "plan_agent";
  }

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
      if (/导出|下载|export|pdf|json|文件/i.test(text)) {
        return "export";
      }
      return "plan_agent"; // User wants modifications
    }
    case "exporting":
      return "export";
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
  .addNode("info_collector", infoCollector)
  .addNode("plan_agent", callPlanAgent)
  .addNode("export", exportNode)
  .addNode("save", saveNode)
  .addConditionalEdges(START, routeByIntent)
  .addEdge("info_collector", END)
  .addEdge("plan_agent", END)
  .addEdge("export", END)
  .addEdge("save", END);

const checkpointer = new MemorySaver();
export const travelAgent = workflow.compile({ checkpointer });
