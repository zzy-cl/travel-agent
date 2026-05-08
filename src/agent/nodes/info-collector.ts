import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { model } from "../../lib/llm";
import type { AgentStateType } from "../state";
import { buildInfoSystemPrompt } from "../prompts/info";
import { confirmInfo, updateCollectedInfo } from "../tools";
import { extractAndCleanText } from "../../lib/tool-call-utils";
import { extractTextContent, mergeCollectedInfo, stringifyToolResult } from "../../lib/agent-utils";

const infoTools = [updateCollectedInfo, confirmInfo];
const modelWithInfoTools = model.bindTools(infoTools);

export async function infoCollector(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const messages = [{ role: "system", content: buildInfoSystemPrompt() }, ...state.messages];
  const response = await modelWithInfoTools.invoke(messages);

  const responseText = extractTextContent(response);

  // Build the list of tool calls to process
  const officialCalls =
    AIMessage.isInstance(response) && response.tool_calls?.length ? response.tool_calls : [];

  // Always scan text for trailing JSON — DeepSeek may embed tool call JSON in the
  // text content even when it also returns proper tool_use blocks.
  const { textCalls, cleanText } = extractAndCleanText(responseText);

  // Use text-based calls only as fallback when official tool_calls are missing
  const fallbackCalls = officialCalls.length === 0 ? textCalls : [];

  // No tool calls of either kind — LLM just responded with text
  if (officialCalls.length === 0 && fallbackCalls.length === 0) {
    return { messages: [response], collectedInfo: state.collectedInfo };
  }

  // If we cleaned JSON from the text, create a clean AIMessage for display
  const displayResponse =
    cleanText !== responseText && cleanText.length > 0 ? new AIMessage(cleanText) : response;

  // Execute tools and merge collected info in a single pass
  const toolMessages: ToolMessage[] = [];
  let updatedInfo = { ...state.collectedInfo };
  let hasConfirm = false;

  // Process official tool calls
  for (const tc of officialCalls) {
    if (tc.name === "update_collected_info") {
      const result = await updateCollectedInfo.invoke(tc.args);
      toolMessages.push(
        new ToolMessage({
          content: stringifyToolResult(result),
          tool_call_id: tc.id ?? "",
          name: "update_collected_info",
        }),
      );
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

  // Process text-embedded fallback tool calls (only when DeepSeek skipped tool_use blocks)
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

  // Guard: if LLM called confirm_info but core fields are missing, reject confirmation
  const hasCoreFields = Boolean(updatedInfo.destination && updatedInfo.days && updatedInfo.people);
  if (hasConfirm && !hasCoreFields) {
    hasConfirm = false;
  }
  if (!hasConfirm && hasCoreFields) {
    hasConfirm = true;
  }

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

    const interruptMsg = `已收集到以下信息：\n\n${summary}\n\n要开始生成旅行计划吗？回复"确认"我立即开始，或告诉我需要补充的信息。`;

    return {
      messages: [displayResponse, ...toolMessages],
      collectedInfo: updatedInfo,
      phase: "confirming",
      interruptMessage: interruptMsg,
      planMarkdown: "",
    };
  }

  return {
    messages: [displayResponse, ...toolMessages],
    collectedInfo: updatedInfo,
  };
}
