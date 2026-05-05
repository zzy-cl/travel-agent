// src/agent/graph.ts
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

const infoToolsList = [updateCollectedInfo, confirmInfo];
const infoToolNode = new ToolNode(infoToolsList);

const planToolsList = [
  searchAttractions,
  searchNearby,
  getWeather,
  webSearch,
  submitPlan,
];
const planToolNode = new ToolNode(planToolsList);

// ── 路由辅助 ──
function lastHumanText(state: AgentStateType): string {
  const lastHuman = [...state.messages]
    .reverse()
    .find((m) => m.getType() === "human");
  if (!lastHuman) return "";
  return typeof lastHuman.content === "string" ? lastHuman.content : "";
}

function isConfirmIntent(state: AgentStateType): boolean {
  return /^(没问题|确认|确定|好的|可以|OK|ok|行|嗯|对|保存)\b/.test(
    lastHumanText(state),
  );
}

// ── 核心路由：根据 phase 路由到合适的 agent ──
function routeByPhase(
  state: AgentStateType,
): "info_agent" | "plan_agent" | "save" | typeof END {
  if (state.phase === "info_gathering") return "info_agent";
  if (state.phase === "planning" || state.phase === "refinement")
    return "plan_agent";
  if (state.phase === "confirming" && isConfirmIntent(state)) return "save";
  if (state.phase === "confirming") return "plan_agent";
  return END;
}

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

// ── process_info：更新 collectedInfo + phase，不调用 interrupt ──
function processInfo(state: AgentStateType): Partial<AgentStateType> {
  return processInfoToolsResult(state);
}

function routeAfterProcess(
  state: AgentStateType,
): "info_interrupt" | "info_agent" | "plan_agent" | typeof END {
  if (state.phase === "planning") return "info_interrupt";
  const route = routeByPhase(state);
  if (route === "save") return END;
  return route;
}

// ── info_interrupt：确认信息后暂停 ──
function infoInterrupt(state: AgentStateType): Partial<AgentStateType> {
  const info = state.collectedInfo;
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
  return {};
}

// ── after_plan：检查是否调用了 submit_plan ──
function afterPlan(state: AgentStateType): Partial<AgentStateType> {
  const lastMessage = state.messages.at(-1);
  if (!lastMessage || !AIMessage.isInstance(lastMessage)) return {};

  const hasSubmitPlan = lastMessage.tool_calls?.some(
    (tc) => tc.name === "submit_plan",
  );

  if (hasSubmitPlan) return { phase: "confirming" };
  return {};
}

function routeAfterAfterPlan(
  state: AgentStateType,
): "plan_interrupt" | typeof END | "save" {
  if (state.phase === "confirming" && !isConfirmIntent(state))
    return "plan_interrupt";
  if (state.phase === "confirming" && isConfirmIntent(state)) return "save";
  if (state.phase === "done") return "save";
  return END;
}

// ── plan_interrupt：计划生成后暂停 ──
function planInterrupt(_state: AgentStateType): Partial<AgentStateType> {
  interrupt(
    `旅行计划已生成！请查看上方内容。你可以：\n- 说"没问题"保存计划\n- 说修改意见，如"第二天换成海边景点"`,
  );
  return {};
}

// ── 图构建 ──
const workflow = new StateGraph(AgentState)
  .addNode("info_agent", callInfoAgent)
  .addNode("info_tools", infoToolNode)
  .addNode("process_info", processInfo)
  .addNode("info_interrupt", infoInterrupt)
  .addNode("plan_agent", callPlanAgent)
  .addNode("plan_tools", planToolNode)
  .addNode("after_plan", afterPlan)
  .addNode("plan_interrupt", planInterrupt)
  .addNode("save", saveNode)

  // 固定边
  .addEdge("info_tools", "process_info")
  .addEdge("info_interrupt", END)
  .addEdge("plan_interrupt", END)
  .addEdge("plan_tools", "plan_agent")
  .addEdge("save", END)

  // START → 根据 phase + 用户意图路由
  .addConditionalEdges(START, routeByPhase)

  // process_info → info_interrupt（确认）或继续路由
  .addConditionalEdges("process_info", routeAfterProcess)

  // info_agent → 有工具调用就执行工具，否则结束
  .addConditionalEdges("info_agent", routeAfterInfo, {
    info_tools: "info_tools",
    after_info: END,
  })

  // plan_agent → 有工具调用就执行工具，否则进入 after_plan
  .addConditionalEdges("plan_agent", routeAfterPlan, {
    plan_tools: "plan_tools",
    after_plan: "after_plan",
  })

  // after_plan → plan_interrupt / save / END
  .addConditionalEdges("after_plan", routeAfterAfterPlan);

const checkpointer = new MemorySaver();

export const travelAgent = workflow.compile({ checkpointer });
