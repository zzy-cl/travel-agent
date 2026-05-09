// src/agent/state.ts
// Agent 共享状态定义
//
// 这是整个 Agent 的"数据模型"。所有节点（info_collector、plan_agent、save）
// 都通过读写这个状态来协作。
//
// ── LangGraph 的 Annotation.Root 简介 ──
// Annotation.Root 类似 TypeScript 的 interface，但额外支持 reducer（合并策略）。
// 当一个节点返回 Partial<State> 时，LangGraph 会用 reducer 将返回值合并到全局状态中。
//
// ── reducer 的含义 ──
// reducer(x, y) 决定"旧值 x"和"新值 y"如何合并:
// - (x, y) => x.concat(y)  → 追加模式（messages: 新消息追加到末尾）
// - (_, y) => y            → 覆盖模式（phase: 新阶段直接替换旧阶段）
// - (_, y) => y            → 覆盖模式（collectedInfo: 新信息直接替换旧信息）
//
// 为什么 messages 用 concat 而其他字段用覆盖？
// 因为 messages 是对话历史，需要累加；而 phase、collectedInfo 等是"当前值"，只需要最新状态。

import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import type { CollectedInfo } from "../schemas/collected-info";

/** Agent 的所有可能阶段 */
export type Phase = "info_gathering" | "planning" | "refinement" | "confirming" | "done";

/** 旅行状态: planning=规划中, ongoing=旅行进行中, completed=已完成 */
export type TripStatus = "planning" | "ongoing" | "completed";

export const AgentState = Annotation.Root({
  // 对话消息历史（累加模式: 新消息追加，不覆盖）
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  // 已收集的旅行信息（覆盖模式: 每次更新用最新的完整值替换）
  collectedInfo: Annotation<CollectedInfo>({
    reducer: (_, newVal) => newVal,
    default: () => ({ preferences: [], constraints: [], highlights: [] }),
  }),
  // 当前阶段（覆盖模式）
  phase: Annotation<Phase>({
    reducer: (_, newVal) => newVal,
    default: () => "info_gathering",
  }),
  // 中断消息（信息确认时展示给用户的汇总文本）
  interruptMessage: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  // 旅行计划 Markdown（plan_agent 生成后存储）
  planMarkdown: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  // 旅行状态（planning → ongoing → completed）
  tripStatus: Annotation<TripStatus>({
    reducer: (_, newVal) => newVal,
    default: () => "planning",
  }),
  // 会话 ID（用于 checkpointer 区分不同对话）
  sessionId: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  // 用户 ID
  userId: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
});

/** 从 Annotation 推导出的 TypeScript 类型，供节点函数使用 */
export type AgentStateType = typeof AgentState.State;
