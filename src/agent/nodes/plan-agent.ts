// src/agent/nodes/plan-agent.ts
// 计划生成节点 — 多轮工具调用 + 旅行计划生成
//
// 这是 Agent 最复杂的节点。它的职责是:
// 1. 根据收集到的旅行信息，调用多个工具（天气、搜索、地图）收集数据
// 2. 综合所有数据，生成详细的旅行计划
// 3. 通过 submit_plan 工具提交最终计划
//
// ── tool-call loop（工具调用循环）──
// 这是 Agent 模式的核心工作方式:
//
//   LLM 推理 → 调用工具 → 执行工具 → 结果回传 → LLM 继续推理 → ... → 最终提交
//
// 每一轮循环中，LLM 可能调用 1 个或多个工具。
// 例如第 1 轮调用 get_weather + search_attractions，第 2 轮调用 web_search + fetch_search。
// 最多进行 MAX_ROUNDS 轮，防止死循环。
//
// ── submit_plan — 透传工具 ──
// submit_plan 是一个"透传"工具: 它不调用任何外部 API，只是把 LLM 生成的
// Markdown 文本原样返回。节点检测到 submit_plan 被调用后，就知道计划已生成完毕。

import { AIMessage, ToolMessage, HumanMessage } from "@langchain/core/messages";
import { model } from "../../lib/llm";
import type { AgentStateType } from "../state";
import { buildPlanSystemPrompt } from "../prompts/plan";
import { planTools } from "../tools";
import { extractAndCleanText } from "../../lib/tool-call-utils";
import type { ToolInput } from "../../lib/types";
import { extractTextContent, mergeCollectedInfo, stringifyToolResult } from "../../lib/agent-utils";

// 绑定所有计划工具到 LLM（共 7 个工具）
const modelWithPlanTools = model.bindTools(planTools);

/**
 * 计划生成节点函数。
 *
 * 输入: 当前 AgentState（messages + collectedInfo + tripStatus）
 * 输出: Partial<AgentStateType>（新增消息 + 生成的计划 + 阶段变更）
 */
export async function planAgent(state: AgentStateType): Promise<Partial<AgentStateType>> {
  // 构建 system prompt，包含用户需求和工具使用指南
  const systemPrompt = buildPlanSystemPrompt(state.collectedInfo, state.tripStatus);
  const messages = [{ role: "system", content: systemPrompt }, ...state.messages];

  // 第一次调用 LLM
  let response = await modelWithPlanTools.invoke(messages);

  // 跟踪 collectedInfo 的更新（plan_agent 也可能调用 update_collected_info）
  let collectedInfoUpdates: AgentStateType["collectedInfo"] | null = { ...state.collectedInfo };

  // ── 工具调用循环 ──
  let rounds = 0;
  const MAX_ROUNDS = 5; // 死循环保护: 最多 5 轮工具调用
  const calledTools = new Set<string>(); // 记录已调用的工具（用于 soft constraint 检查）

  // 循环条件: LLM 返回了 tool_calls → 继续执行工具
  while (AIMessage.isInstance(response) && (response.tool_calls?.length ?? 0) > 0) {
    rounds++;
    const toolCalls = response.tool_calls!;
    const hasSubmitPlan = toolCalls.some((tc) => tc.name === "submit_plan");

    // ── Soft Constraint: 防止 LLM 跳过搜索直接提交 ──
    // 有些 LLM（特别是快速模式下）会跳过搜索，直接用已有知识生成计划。
    // 这里强制: 如果前 2 轮就调用 submit_plan 但还没搜索过，先执行搜索再提交。
    if (hasSubmitPlan && rounds <= 2) {
      const hasSearched =
        calledTools.has("web_search") ||
        calledTools.has("get_attraction_detail") ||
        calledTools.has("search_attractions");
      const hasWeather = calledTools.has("get_weather");
      if (!hasSearched || !hasWeather) {
        const missing = [];
        if (!hasWeather) missing.push("get_weather 查询天气");
        if (!hasSearched) missing.push("web_search 或 get_attraction_detail 搜索景点信息");

        // 执行本轮中非 submit_plan 的工具
        const nonSubmitCalls = toolCalls.filter((tc) => tc.name !== "submit_plan");
        const submitTc = toolCalls.find((tc) => tc.name === "submit_plan");
        const preToolMessages: ToolMessage[] = [];
        for (const tc of nonSubmitCalls) {
          calledTools.add(tc.name);
          const tool = planTools.find((t) => t.name === tc.name);
          if (tool) {
            try {
              const result = await tool.invoke(tc.args as ToolInput);
              preToolMessages.push(
                new ToolMessage({
                  content: stringifyToolResult(result),
                  tool_call_id: tc.id ?? "",
                  name: tc.name,
                }),
              );
              if (tc.name === "update_collected_info") {
                collectedInfoUpdates = mergeCollectedInfo(collectedInfoUpdates!, tc.args);
              }
            } catch (err) {
              console.error(`[plan-agent] Tool ${tc.name} failed:`, err);
              preToolMessages.push(
                new ToolMessage({
                  content: `工具 ${tc.name} 执行失败。请用已有知识继续，不要重试此工具。`,
                  tool_call_id: tc.id ?? "",
                  name: tc.name,
                }),
              );
            }
          }
        }

        // 为跳过的 submit_plan 生成一个 tool_result（保持消息链完整）
        if (submitTc) {
          preToolMessages.push(
            new ToolMessage({
              content: `submit_plan 被暂缓执行。请先完成以下搜索：${missing.join("、")}。完成后可再次调用 submit_plan。`,
              tool_call_id: submitTc.id ?? "",
              name: "submit_plan",
            }),
          );
        }

        // 重新调用 LLM，附带提示信息
        response = await modelWithPlanTools.invoke([
          ...messages,
          response,
          ...preToolMessages,
          new HumanMessage({
            content: `建议先用 ${missing.join("、")} 获取实时数据，再提交计划。如果工具失败，用已有知识继续，不要重试。如果你已有足够信息，可以直接调用 submit_plan。`,
          }),
        ]);
        continue; // 回到 while 循环顶部
      }
    }

    // ── 执行所有工具调用 ──
    const toolMessages: ToolMessage[] = [];
    for (const tc of toolCalls) {
      calledTools.add(tc.name);
      const tool = planTools.find((t) => t.name === tc.name);
      if (tool) {
        try {
          const result = await tool.invoke(tc.args as ToolInput);
          toolMessages.push(
            new ToolMessage({
              content: stringifyToolResult(result),
              tool_call_id: tc.id ?? "",
              name: tc.name,
            }),
          );
          if (tc.name === "update_collected_info") {
            collectedInfoUpdates = mergeCollectedInfo(collectedInfoUpdates!, tc.args);
          }
        } catch (err) {
          console.error(`[plan-agent] Tool ${tc.name} failed:`, err);
          toolMessages.push(
            new ToolMessage({
              content: `工具 ${tc.name} 执行失败。请用已有知识继续，不要重试此工具。`,
              tool_call_id: tc.id ?? "",
              name: tc.name,
            }),
          );
        }
      } else {
        // LLM 调用了一个不存在的工具（不应该发生，但要做防御）
        toolMessages.push(
          new ToolMessage({
            content: `未知工具: ${tc.name}`,
            tool_call_id: tc.id ?? "",
            name: tc.name,
          }),
        );
      }
    }

    // ── submit_plan 被调用 → 计划生成完毕 ──
    if (hasSubmitPlan) {
      const planMarkdown = toolMessages.find((m) => m.name === "submit_plan")?.content;
      return {
        messages: [response, ...toolMessages],
        phase: "confirming",
        ...(planMarkdown
          ? {
              planMarkdown:
                typeof planMarkdown === "string" ? planMarkdown : JSON.stringify(planMarkdown),
            }
          : {}),
        ...(collectedInfoUpdates ? { collectedInfo: collectedInfoUpdates } : {}),
      };
    }

    // ── 死循环保护: 达到最大轮次，强制提交 ──
    if (rounds >= MAX_ROUNDS) {
      const forceResponse = await modelWithPlanTools.invoke([
        ...messages,
        response,
        ...toolMessages,
        new HumanMessage({
          content:
            "工具搜索多次失败或已达上限。请不要再搜索，直接使用已有信息调用 submit_plan 生成旅行计划。即使信息不完美也比没有计划好。",
        }),
      ]);

      // LLM 配合了 → 正常提取 submit_plan 结果
      if (
        AIMessage.isInstance(forceResponse) &&
        forceResponse.tool_calls?.some((tc) => tc.name === "submit_plan")
      ) {
        const submitTc = forceResponse.tool_calls?.find((tc) => tc.name === "submit_plan");
        const submitTool = planTools.find((t) => t.name === "submit_plan");
        if (submitTc && submitTool) {
          const result = await submitTool.invoke(submitTc.args as ToolInput);
          const planText = stringifyToolResult(result);
          const submitResultMsg = new ToolMessage({
            content: planText,
            tool_call_id: submitTc.id ?? "",
            name: "submit_plan",
          });
          return {
            messages: [response, ...toolMessages, forceResponse, submitResultMsg],
            phase: "confirming",
            planMarkdown: planText,
            ...(collectedInfoUpdates ? { collectedInfo: collectedInfoUpdates } : {}),
          };
        }
      }

      // LLM 仍然不配合 → 使用它的文本回复作为计划（最后手段）
      const forceToolResults: ToolMessage[] = [];
      if (AIMessage.isInstance(forceResponse) && forceResponse.tool_calls?.length) {
        for (const tc of forceResponse.tool_calls) {
          forceToolResults.push(
            new ToolMessage({
              content: `工具 ${tc.name} 已跳过`,
              tool_call_id: tc.id ?? "",
              name: tc.name,
            }),
          );
        }
      }
      const fallbackContent = AIMessage.isInstance(forceResponse)
        ? extractTextContent(forceResponse)
        : "";
      return {
        messages: [response, ...toolMessages, forceResponse, ...forceToolResults],
        phase: "confirming",
        ...(fallbackContent ? { planMarkdown: fallbackContent } : {}),
        ...(collectedInfoUpdates ? { collectedInfo: collectedInfoUpdates } : {}),
      };
    }

    // 继续循环 — 将工具结果回传给 LLM，让它决定下一步
    response = await modelWithPlanTools.invoke([...messages, response, ...toolMessages]);
  }

  // ── 正常退出循环: LLM 没有调用工具，直接返回了文本 ──
  // DeepSeek 可能把 update_collected_info JSON 嵌入到文本中（workaround）
  const responseText = AIMessage.isInstance(response) ? extractTextContent(response) : "";

  const { textCalls, cleanText } = extractAndCleanText(responseText);

  if (textCalls.length > 0) {
    for (const tc of textCalls) {
      if (tc.name === "update_collected_info") {
        collectedInfoUpdates = mergeCollectedInfo(collectedInfoUpdates!, tc.args);
      }
    }
    const displayResponse = cleanText.length > 0 ? new AIMessage({ content: cleanText }) : response;
    return {
      messages: [displayResponse],
      collectedInfo: collectedInfoUpdates ?? state.collectedInfo,
    };
  }

  return {
    messages: [response],
    collectedInfo: collectedInfoUpdates ?? state.collectedInfo,
  };
}
