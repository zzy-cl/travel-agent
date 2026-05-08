import { END, START, StateGraph, MemorySaver } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { AgentState, type AgentStateType } from "./state";
import { infoCollector } from "./nodes/info-collector";
import { planAgent } from "./nodes/plan-agent";

// ── Route intent keywords ──
// Extracted from inline regex for maintainability.

/** Keywords that indicate the user confirms and wants to proceed. */
const CONFIRM_PATTERN =
  /^(确认|确定|好的|可以|ok|行|嗯|对|yes|sure|good|looks\s*good|没问题|生成|开始|开始吧|开始生成|生成计划|帮我生成|帮我规划|go|start|生成吧)[\s!！。.、，,]*$/i;

/** Keywords that indicate the user wants to save the plan. */
const SAVE_PATTERN =
  /^(没问题|确认|确定|好的|可以|ok|行|嗯|对|保存|没问题的|确认一下|yes|sure|good|looks\s*good)[\s!！。.、，,]*$/i;

/** Keywords that negate a confirmation (e.g. "好的，但是..."). */
const NEGATION_PATTERN = /但|但是|不过|然而|换成|替换|修改|调整|换一下|补充|补充一下|帮你/i;

/** Pattern for adjust/regenerate intent on an existing plan. */
const ADJUST_PATTERN = /但|但是|不过|然而|换成|替换|修改|调整|换一下/i;

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
      const lastHuman = [...state.messages].reverse().find((m) => m.getType() === "human");
      const text =
        lastHuman && typeof lastHuman.content === "string" ? lastHuman.content.trim() : "";

      // Info confirming: collected info ready, waiting for user to "确认生成" or supplement
      if (!state.planMarkdown) {
        if (CONFIRM_PATTERN.test(text) && !NEGATION_PATTERN.test(text)) {
          return "plan_agent";
        }
        return "info_collector";
      }

      // Plan confirming: plan generated, waiting for user to "save" or adjust
      if (SAVE_PATTERN.test(text) && !ADJUST_PATTERN.test(text)) {
        return "save";
      }
      // User wants to adjust — route to info_collector to update info, then re-confirm
      return "info_collector";
    }
    default:
      return END;
  }
}

// ── Save: mark trip as completed ──
function saveNode(): Partial<AgentStateType> {
  return { phase: "done", tripStatus: "completed" };
}

// ── Build graph ──
const workflow = new StateGraph(AgentState)
  .addNode("info_collector", infoCollector)
  .addNode("plan_agent", planAgent)
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

/**
 * Creates the checkpointer for LangGraph state persistence.
 *
 * Default: MemorySaver (in-memory, state lost on server restart).
 * For Vercel/serverless production, install and configure a persistent backend:
 *
 *   # Option 1: PostgreSQL (Neon, Supabase, etc.)
 *   npm install @langchain/langgraph-checkpoint-postgres
 *   CHECKPOINTER_BACKEND=postgres DATABASE_URL=postgresql://...
 *
 *   # Option 2: Redis (Upstash, etc.)
 *   npm install @langchain/langgraph-checkpoint-redis
 *   CHECKPOINTER_BACKEND=redis REDIS_URL=redis://...
 *
 * Then replace this function with the appropriate saver.
 */
function createCheckpointer(): BaseCheckpointSaver {
  // Default: in-memory — fine for dev, lost on cold starts in production
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[travel-agent] Using MemorySaver in production — conversation state will be lost on cold starts. " +
        "See src/agent/graph.ts for persistent checkpointer setup.",
    );
  }
  return new MemorySaver();
}

const checkpointer = createCheckpointer();
export const travelAgent = workflow.compile({ checkpointer });
