// src/agent/graph.ts
// LangGraph 状态图定义 — Agent 的"大脑"
//
// 这个文件定义了整个 Agent 的控制流:
// 1. 有哪些节点（info_collector、plan_agent、save）
// 2. 节点之间如何跳转（条件路由 routeByIntent）
// 3. 如何持久化状态（MemorySaver checkpointer）
//
// ── StateGraph 简介 ──
// StateGraph 是 LangGraph 的核心概念。它是一个有向图:
// - 节点（Node）: 处理函数，读取状态并返回状态更新
// - 边（Edge）: 节点之间的跳转规则
// - 条件边（Conditional Edge）: 根据状态动态决定跳转目标
//
// ── 本项目的图结构 ──
//
//                    ┌─────────────┐
//                    │    START     │
//                    └──────┬──────┘
//                           │
//                    ┌──────▼──────┐
//                    │routeByIntent│  ← 读取 phase/tripStatus/最后一条消息
//                    └──────┬──────┘
//                           │
//              ┌────────────┼────────────┬──────────┐
//              ▼            ▼            ▼          ▼
//     ┌────────────┐ ┌────────────┐ ┌──────┐   ┌─────┐
//     │info_collector│ │plan_agent  │ │ save │   │ END │
//     └──────┬─────┘ └──────┬─────┘ └──┬───┘   └─────┘
//            │              │          │
//            ▼              ▼          ▼
//          [END]          [END]     [END]
//
// 每次用户发消息，图从 START 开始执行，经过路由到某个节点，
// 节点执行完后到 END，等待下一条消息。

import { END, START, StateGraph, MemorySaver } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { AgentState, type AgentStateType } from "./state";
import { infoCollector } from "./nodes/info-collector";
import { planAgent } from "./nodes/plan-agent";

// ── 路由正则常量 ──
// 用于检测用户意图: 确认生成、保存计划、补充修改等。

/** 用户确认并想继续（如"确认"、"好的"、"生成计划"） */
const CONFIRM_PATTERN =
  /^(确认|确定|好的|可以|ok|行|嗯|对|yes|sure|good|looks\s*good|没问题|生成|开始|开始吧|开始生成|生成计划|帮我生成|帮我规划|go|start|生成吧)[\s!！。.、，,]*$/i;

/** 用户想保存计划（如"没问题"、"保存"、"确认一下"） */
const SAVE_PATTERN =
  /^(没问题|确认|确定|好的|可以|ok|行|嗯|对|保存|没问题的|确认一下|yes|sure|good|looks\s*good)[\s!！。.、，,]*$/i;

/** 否定词: "好的，但是..." 不算确认 */
const NEGATION_PATTERN = /但|但是|不过|然而|换成|替换|修改|调整|换一下|补充|补充一下|帮你/i;

/** 调整意图: 用户想修改已有计划 */
const ADJUST_PATTERN = /但|但是|不过|然而|换成|替换|修改|调整|换一下/i;

/**
 * 路由函数: 根据当前状态决定下一个节点。
 *
 * 这是 Agent 的"决策中心"。每次用户发消息时，LangGraph 调用这个函数
 * 决定应该把消息交给哪个节点处理。
 *
 * 路由逻辑:
 * 1. 旅行进行中 → 始终交给 plan_agent（实时助手模式）
 * 2. 信息收集阶段 → 交给 info_collector
 * 3. 计划生成/修改阶段 → 交给 plan_agent
 * 4. 确认阶段 → 根据用户消息内容判断:
 *    - 无计划 + 确认 → plan_agent（开始生成）
 *    - 无计划 + 补充 → info_collector（继续收集）
 *    - 有计划 + 保存 → save（标记完成）
 *    - 有计划 + 修改 → info_collector（更新信息）
 */
function routeByIntent(
  state: AgentStateType,
): "info_collector" | "plan_agent" | "save" | typeof END {
  // 旅行进行中 → 始终交给 plan_agent
  if (state.tripStatus === "ongoing") {
    return "plan_agent";
  }

  switch (state.phase) {
    case "info_gathering":
      return "info_collector";
    case "planning":
    case "refinement":
    case "done": // 已保存的计划重新生成
      return "plan_agent";
    case "confirming": {
      // 提取用户最后一条消息，判断意图
      const lastHuman = [...state.messages].reverse().find((m) => m.getType() === "human");
      const text =
        lastHuman && typeof lastHuman.content === "string" ? lastHuman.content.trim() : "";

      // 信息确认中（无计划）: 用户确认 → 生成计划；用户补充 → 继续收集
      if (!state.planMarkdown) {
        if (CONFIRM_PATTERN.test(text) && !NEGATION_PATTERN.test(text)) {
          return "plan_agent";
        }
        return "info_collector";
      }

      // 计划确认中（有计划）: 用户保存 → save；用户修改 → info_collector
      if (SAVE_PATTERN.test(text) && !ADJUST_PATTERN.test(text)) {
        return "save";
      }
      return "info_collector";
    }
    default:
      return END;
  }
}

/**
 * 保存节点: 标记旅行完成。
 *
 * 这是最简单的节点 —— 只返回状态更新，不调用 LLM。
 * 在 LangGraph 中，节点可以是任何接收状态并返回 Partial<State> 的函数。
 */
function saveNode(): Partial<AgentStateType> {
  return { phase: "done", tripStatus: "completed" };
}

// ── 构建状态图 ──
// addNode: 注册节点（名称 + 处理函数）
// addConditionalEdges: 注册条件边（从 START 出发，由 routeByIntent 决定目标）
// addEdge: 注册固定边（节点执行完后直接到 END）
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
 * 创建 checkpointer（状态快照存储器）。
 *
 * checkpointer 的作用: 每次图执行后，LangGraph 会保存一份状态快照。
 * 下次同一 thread_id 的消息进来时，可以从快照恢复状态，实现多轮对话。
 *
 * MemorySaver: 内存存储，适合开发。生产环境应替换为持久化存储:
 * - PostgreSQL: @langchain/langgraph-checkpoint-postgres
 * - Redis: @langchain/langgraph-checkpoint-redis
 */
function createCheckpointer(): BaseCheckpointSaver {
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[travel-agent] Using MemorySaver in production — conversation state will be lost on cold starts. " +
        "See src/agent/graph.ts for persistent checkpointer setup.",
    );
  }
  return new MemorySaver();
}

const checkpointer = createCheckpointer();

/**
 * compile(): 将 StateGraph 编译为可执行的 agent。
 *
 * 编译后的 agent 支持:
 * - .invoke(input, config): 同步执行，返回最终状态
 * - .stream(input, config): 流式执行，逐步返回状态变化
 *
 * config 中的 configurable.thread_id 决定了使用哪个状态快照。
 */
export const travelAgent = workflow.compile({ checkpointer });
