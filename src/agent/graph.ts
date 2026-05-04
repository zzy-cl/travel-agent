// src/agent/graph.ts
import "dotenv/config";
import {
  END,
  START,
  StateGraph,
  interrupt,
  MemorySaver,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage } from "@langchain/core/messages";
import { AgentState, type AgentStateType } from "./state";
import { router } from "./nodes/router";
import { callInfoAgent, processInfoToolsResult } from "./nodes/info-agent";
import { callPlanAgent } from "./nodes/plan-agent";
import { saveNode } from "./nodes/save";
import {
  updateCollectedInfo,
  confirmInfo,
  searchAttractions,
  searchNearby,
  getWeather,
  webSearch,
  submitPlan,
} from "./tools";

// Info tools (for infoAgent's ToolNode)
const infoToolsList = [updateCollectedInfo, confirmInfo];
const infoToolNode = new ToolNode(infoToolsList);

// Plan tools (for planAgent's ToolNode)
const planToolsList = [
  searchAttractions,
  searchNearby,
  getWeather,
  webSearch,
  submitPlan,
];
const planToolNode = new ToolNode(planToolsList);

// ── processInfoToolsResult wrapper with interrupt ──
// 在 info_tools 执行后运行，更新 collectedInfo 并检查是否需要中断
function processInfoWithInterrupt(
  state: AgentStateType,
): Partial<AgentStateType> {
  const updates = processInfoToolsResult(state);

  // 如果 phase 变为 planning，说明 confirm_info 被调用
  if (updates.phase === "planning") {
    const info = { ...state.collectedInfo, ...(updates.collectedInfo || {}) };
    const summary = [
      info.destination && `目的地：${info.destination}`,
      info.days && `天数：${info.days}天`,
      info.people && `人数：${info.people}人`,
      info.dateRange && `日期：${info.dateRange}`,
      info.budget && `预算：${info.budget}`,
      info.preferences.length && `偏好：${info.preferences.join("、")}`,
      info.constraints.length && `约束：${info.constraints.join("、")}`,
    ]
      .filter(Boolean)
      .join("\n");

    interrupt(
      `已收集到以下信息：\n\n${summary}\n\n确认无误请回复"确认"，或告诉我需要补充的信息。`,
    );
  }

  return updates;
}

// ── afterPlanAgent wrapper with interrupt ──
function afterPlanAgentWithInterrupt(
  state: AgentStateType,
): Partial<AgentStateType> {
  const lastMessage = state.messages.at(-1);
  if (!lastMessage || !AIMessage.isInstance(lastMessage)) return {};

  const hasSubmitPlan = lastMessage.tool_calls?.some(
    (tc) => tc.name === "submit_plan",
  );

  if (hasSubmitPlan) {
    interrupt(
      `旅行计划已生成！请查看上方内容。你可以：\n- 说“没问题”保存计划\n- 说修改意见，如“第二天换成海边景点”`,
    );
  }

  return {};
}

// ── 条件路由 ──
function routeAfterInfo(state: AgentStateType): "info_tools" | "after_info" {
  const lastMessage = state.messages.at(-1);
  if (!lastMessage || !AIMessage.isInstance(lastMessage)) return "after_info";
  if (lastMessage.tool_calls?.length) return "info_tools";
  return "after_info";
}

function routeAfterPlan(state: AgentStateType): "plan_tools" | "after_plan" {
  const lastMessage = state.messages.at(-1);
  if (!lastMessage || !AIMessage.isInstance(lastMessage)) return "after_plan";
  if (lastMessage.tool_calls?.length) return "plan_tools";
  return "after_plan";
}

// ── 图构建 ──
const workflow = new StateGraph(AgentState)
  // 节点
  .addNode("router", router)
  .addNode("info_agent", callInfoAgent)
  .addNode("info_tools", infoToolNode)
  .addNode("process_info", processInfoWithInterrupt)
  .addNode("plan_agent", callPlanAgent)
  .addNode("plan_tools", planToolNode)
  .addNode("after_plan", afterPlanAgentWithInterrupt)
  .addNode("save", saveNode)

  // 固定边
  .addEdge(START, "router")
  .addEdge("info_tools", "process_info")
  .addEdge("process_info", "router")
  .addEdge("plan_tools", "plan_agent")
  .addEdge("save", END)

  // 条件边：router 根据 phase 路由
  .addConditionalEdges("router", (state: AgentStateType) => {
    if (state.phase === "info_gathering") return "info_agent";
    if (state.phase === "planning" || state.phase === "refinement")
      return "plan_agent";
    return END;
  })

  // 条件边：info_agent 之后 → 有工具调用就执行工具，否则回到 router
  .addConditionalEdges("info_agent", routeAfterInfo, {
    info_tools: "info_tools",
    after_info: "router",
  })

  // 条件边：plan_agent 之后
  .addConditionalEdges("plan_agent", routeAfterPlan, {
    plan_tools: "plan_tools",
    after_plan: "after_plan",
  })

  // after_plan → save 或 router
  .addConditionalEdges("after_plan", (state: AgentStateType) => {
    if (state.phase === "done") return "save";
    return "router";
  });

// ── 编译 ──
const checkpointer = new MemorySaver();

export const travelAgent = workflow.compile({ checkpointer });
