import { END, START, StateGraph, interrupt, MemorySaver } from "@langchain/langgraph";
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

// ── Handle interrupt: check interruptMessage and pause ──
function handleInterrupt(state: AgentStateType): Partial<AgentStateType> {
  if (state.interruptMessage) {
    interrupt(state.interruptMessage);
  }
  return { interruptMessage: "" };
}

// ── Save: mark done ──
function saveNode(): Partial<AgentStateType> {
  return { phase: "done" };
}

// ── After agent: route to interrupt or back to router ──
function afterAgent(
  state: AgentStateType,
): "handle_interrupt" | typeof END {
  if (state.interruptMessage) {
    return "handle_interrupt";
  }
  return END;
}

// ── Build graph ──
const workflow = new StateGraph(AgentState)
  // 4 nodes
  .addNode("info_collector", infoCollector)
  .addNode("plan_agent", callPlanAgent)
  .addNode("handle_interrupt", handleInterrupt)
  .addNode("save", saveNode)

  // START → router → agent
  .addConditionalEdges(START, routeByPhase)

  // After each agent: interrupt if needed, else end
  .addConditionalEdges("info_collector", afterAgent)
  .addConditionalEdges("plan_agent", afterAgent)

  // Interrupt → end (waits for user, resumes via checkpointer)
  .addEdge("handle_interrupt", END)

  // Save → end
  .addEdge("save", END);

const checkpointer = new MemorySaver();

export const travelAgent = workflow.compile({ checkpointer });
