// src/agent/nodes/info-collector.ts
// 信息收集节点 — 通过对话提取旅行需求
//
// 这是 Agent 的第一个节点。它的职责是:
// 1. 以"旅行顾问"身份与用户对话
// 2. 从用户的回复中提取旅行信息（目的地、天数、人数等）
// 3. 当信息足够时，生成确认卡片让用户确认
//
// ── 工具调用机制（Agent 的核心概念）──
//
// LLM 本身不能执行代码，它只能输出"我想调用某个工具"的请求。
// 整个流程是:
//
//   1. 我们把工具"绑定"到 LLM（model.bindTools） → LLM 知道有哪些工具可用
//   2. LLM 返回 AIMessage，其中可能包含 tool_calls（结构化的工具调用请求）
//   3. 我们执行工具，得到结果
//   4. 把结果封装为 ToolMessage，连同 AIMessage 一起再次发给 LLM
//   5. LLM 根据工具结果继续推理
//
// ── tool_calls 的格式 ──
// tool_calls: [
//   { id: "call_123", name: "update_collected_info", args: { destination: "北京", days: 3 } }
// ]
//
// ── ToolMessage 的格式 ──
// ToolMessage: { content: "工具执行结果", tool_call_id: "call_123", name: "update_collected_info" }
// tool_call_id 必须与 tool_calls 中的 id 对应，LLM 才能知道这是哪个工具的结果。

import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { model } from "../../lib/llm";
import type { AgentStateType } from "../state";
import { buildInfoSystemPrompt } from "../prompts/info";
import { confirmInfo, updateCollectedInfo } from "../tools";
import { extractAndCleanText } from "../../lib/tool-call-utils";
import { extractTextContent, mergeCollectedInfo, stringifyToolResult } from "../../lib/agent-utils";

// 绑定工具到 LLM: 告诉 LLM "你可以调用这两个工具"
// LLM 会在 system prompt 中看到工具的 name、description 和 schema
const infoTools = [updateCollectedInfo, confirmInfo];
const modelWithInfoTools = model.bindTools(infoTools);

/**
 * 信息收集节点函数。
 *
 * 输入: 当前 AgentState（messages + collectedInfo）
 * 输出: Partial<AgentStateType>（新增的消息 + 更新的 collectedInfo + 可能的阶段变更）
 *
 * LangGraph 会自动将输出合并到全局状态中（通过 state.ts 中定义的 reducer）。
 */
export async function infoCollector(state: AgentStateType): Promise<Partial<AgentStateType>> {
  // 构建消息列表: system prompt + 对话历史
  // system prompt 告诉 LLM 它的角色和任务
  const messages = [{ role: "system", content: buildInfoSystemPrompt() }, ...state.messages];

  // 调用 LLM（可能返回 tool_calls，也可能直接返回文本）
  const response = await modelWithInfoTools.invoke(messages);

  const responseText = extractTextContent(response);

  // ── 收集工具调用 ──
  // 有两个来源:
  // 1. officialCalls: LLM 通过标准 tool_use block 返回的（正确方式）
  // 2. textCalls: LLM 把 JSON 嵌入到文本中的（DeepSeek 的 workaround，见 tool-call-utils.ts）

  const officialCalls =
    AIMessage.isInstance(response) && response.tool_calls?.length ? response.tool_calls : [];

  // 扫描文本中的嵌入式 JSON（DeepSeek workaround）
  const { textCalls, cleanText } = extractAndCleanText(responseText);

  // 只在没有标准 tool_calls 时才使用文本中的 fallback
  const fallbackCalls = officialCalls.length === 0 ? textCalls : [];

  // LLM 没有调用任何工具 → 只是普通对话回复
  if (officialCalls.length === 0 && fallbackCalls.length === 0) {
    return { messages: [response], collectedInfo: state.collectedInfo };
  }

  // 如果清理了文本中的 JSON，创建干净的 AIMessage 用于展示
  const displayResponse =
    cleanText !== responseText && cleanText.length > 0 ? new AIMessage(cleanText) : response;

  // ── 执行工具调用 ──
  const toolMessages: ToolMessage[] = [];
  let updatedInfo = { ...state.collectedInfo };
  let hasConfirm = false;

  // 处理标准 tool_calls
  for (const tc of officialCalls) {
    if (tc.name === "update_collected_info") {
      // 执行工具: 调用 updateCollectedInfo，返回 JSON 字符串
      const result = await updateCollectedInfo.invoke(tc.args);
      toolMessages.push(
        new ToolMessage({
          content: stringifyToolResult(result),
          tool_call_id: tc.id ?? "",
          name: "update_collected_info",
        }),
      );
      // 合并提取的信息到当前状态
      updatedInfo = mergeCollectedInfo(updatedInfo, tc.args);
    } else if (tc.name === "confirm_info") {
      const result = await confirmInfo.invoke({});
      toolMessages.push(
        new ToolMessage({
          content: stringifyToolResult(result),
          tool_call_id: tc.id ?? "",
          name: "confirm_info",
        }),
      );
      hasConfirm = true;
    }
  }

  // 处理文本嵌入的 fallback tool calls（仅当标准 tool_calls 缺失时）
  for (const tc of fallbackCalls) {
    if (tc.name === "update_collected_info") {
      updatedInfo = mergeCollectedInfo(updatedInfo, tc.args);
      toolMessages.push(
        new ToolMessage({
          content: JSON.stringify(tc.args),
          tool_call_id: "fallback",
          name: "update_collected_info",
        }),
      );
    } else if (tc.name === "confirm_info") {
      hasConfirm = true;
      toolMessages.push(
        new ToolMessage({
          content: "信息已确认",
          tool_call_id: "fallback-confirm",
          name: "confirm_info",
        }),
      );
    }
  }

  // ── Guard: 防止 LLM 在信息不全时就确认 ──
  // LLM 有时会"过度热情"，在还没收集到目的地/天数/人数时就调用 confirm_info。
  // 这里强制检查: 三个核心字段缺一不可。
  const hasCoreFields = Boolean(updatedInfo.destination && updatedInfo.days && updatedInfo.people);
  if (hasConfirm && !hasCoreFields) {
    hasConfirm = false; // 信息不全 → 撤销确认，继续收集
  }
  if (!hasConfirm && hasCoreFields) {
    hasConfirm = true; // 信息齐全 → 即使 LLM 没显式确认，也自动进入确认阶段
  }

  // ── 信息确认: 生成汇总文本，进入 confirming 阶段 ──
  if (hasConfirm) {
    const info = updatedInfo;
    const fixedLines = [
      info.destination && `目的地：${info.destination}`,
      info.days && `天数：${info.days}天`,
      info.people && `人数：${info.people}人`,
      info.dateRange && `日期：${info.dateRange}`,
      info.budget && `预算：${info.budget}`,
      info.transport && `交通方式：${info.transport}`,
      info.accommodation && `住宿偏好：${info.accommodation}`,
      info.preferences.length && `偏好：${info.preferences.join("、")}`,
      info.constraints.length && `约束：${info.constraints.join("、")}`,
    ].filter(Boolean);
    const highlightLines = (info.highlights ?? []).map((h) => `${h.label}：${h.value}`);
    const summary = [...fixedLines, ...highlightLines].join("\n");

    // interruptMessage: 展示给用户的确认卡片内容
    const interruptMsg = `已收集到以下信息：\n\n${summary}\n\n要开始生成旅行计划吗？回复"确认"我立即开始，或告诉我需要补充的信息。`;

    return {
      messages: [displayResponse, ...toolMessages],
      collectedInfo: updatedInfo,
      phase: "confirming",
      interruptMessage: interruptMsg,
      planMarkdown: "", // 清空旧计划（如果有）
    };
  }

  // 信息不全 → 继续收集
  return {
    messages: [displayResponse, ...toolMessages],
    collectedInfo: updatedInfo,
  };
}
