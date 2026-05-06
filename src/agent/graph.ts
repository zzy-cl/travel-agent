import { END, START, StateGraph, MemorySaver } from "@langchain/langgraph";
import { AgentState, type AgentStateType } from "./state";
import { infoCollector } from "./nodes/info-collector";
import { callPlanAgent } from "./nodes/plan-agent";

// ── Router: determines target node based on tripStatus and phase ──
function routeByIntent(
  state: AgentStateType,
): "info_collector" | "plan_agent" | "save" | typeof END {
  // Ongoing trips always go to plan_agent (real-time assistance)
  if (state.tripStatus === "ongoing") {
    return "plan_agent";
  }

  switch (state.phase) {
    case "info_gathering":
      return "info_collector";
    case "planning":
    case "refinement":
    case "done": // re-generate after a saved plan
      return "plan_agent";
    case "confirming": {
      if (!state.planMarkdown) return "plan_agent";
      const lastHuman = [...state.messages].reverse().find((m) => m.getType() === "human");
      const text = lastHuman && typeof lastHuman.content === "string" ? lastHuman.content : "";
      if (
        /^(没问题|确认|确定|好的|可以|ok|行|嗯|对|保存|没问题的|确认一下|yes|sure|good|looks\s*good)[\s!！。.、，,]*/i.test(
          text,
        )
      ) {
        return "save";
      }
      return "plan_agent";
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
  .addNode("info_collector", infoCollector)
  .addNode("plan_agent", callPlanAgent)
  .addNode("save", saveNode)
  .addConditionalEdges(START, routeByIntent, {
    info_collector: "info_collector",
    plan_agent: "plan_agent",
    save: "save",
    [END]: END,
  })
  .addEdge("info_collector", END)
  .addEdge("plan_agent", END)
  .addEdge("save", END);

const checkpointer = new MemorySaver();
export const travelAgent = workflow.compile({ checkpointer });
