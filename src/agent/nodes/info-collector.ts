import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { interrupt } from "@langchain/langgraph";
import { model } from "../../lib/llm";
import type { AgentStateType } from "../state";
import { infoSystemPrompt } from "../prompts/info";
import { confirmInfo, updateCollectedInfo, loadPreferences } from "../tools";
import { collectedInfoSchema } from "../../schemas/collected-info";
import { db } from "../../lib/db";

const infoTools = [updateCollectedInfo, confirmInfo];
const modelWithInfoTools = model.bindTools(infoTools);

export async function infoCollector(
  state: AgentStateType,
): Promise<Partial<AgentStateType>> {
  // Load user preferences if userId exists
  let preferenceHint = "";
  if (state.userId) {
    try {
      const prefs = await loadPreferences.invoke({ userId: state.userId });
      if (typeof prefs === "string" && prefs !== "暂无已保存的偏好") {
        preferenceHint = `\n\n用户历史偏好（参考）：${prefs}`;
      }
    } catch {
      // Ignore preference loading errors
    }
  }

  const messages = [{ role: "system", content: infoSystemPrompt + preferenceHint }, ...state.messages];
  const response = await modelWithInfoTools.invoke(messages);

  // No tool calls — LLM just responded with text, continue conversation
  if (!AIMessage.isInstance(response) || !response.tool_calls?.length) {
    return { messages: [response] };
  }

  // Execute tools
  const toolMessages: ToolMessage[] = [];
  for (const tc of response.tool_calls) {
    if (tc.name === "update_collected_info") {
      toolMessages.push(
        new ToolMessage({
          content: JSON.stringify(tc.args),
          tool_call_id: tc.id!,
          name: "update_collected_info",
        }),
      );
    } else if (tc.name === "confirm_info") {
      toolMessages.push(
        new ToolMessage({
          content: "信息收集完成",
          tool_call_id: tc.id!,
          name: "confirm_info",
        }),
      );
    }
  }

  // Merge collected info from ALL update_collected_info calls (Bug #1 fix)
  let updatedInfo = { ...state.collectedInfo };
  let hasConfirm = false;

  for (const tc of response.tool_calls) {
    if (tc.name === "update_collected_info") {
      const parsed = collectedInfoSchema.partial().safeParse(tc.args);
      if (parsed.success) {
        const newInfo = parsed.data;
        updatedInfo = {
          ...updatedInfo,
          ...newInfo,
          preferences: newInfo.preferences ?? updatedInfo.preferences,
          constraints: newInfo.constraints ?? updatedInfo.constraints,
        };
      }
    }
    if (tc.name === "confirm_info") {
      hasConfirm = true;
    }
  }

  if (hasConfirm) {
    const info = updatedInfo;
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

    interrupt(`已收集到以下信息：\n\n${summary}\n\n确认无误请回复"确认"，或告诉我需要补充的信息。`);

    // Save trip to DB (non-blocking)
    if (state.userId) {
      db.trip.create({
        data: {
          userId: state.userId,
          planMarkdown: "",
          collectedInfo: JSON.stringify(updatedInfo),
          status: "planning",
        },
      }).catch(() => {}); // Non-critical: don't block on failure
    }

    return {
      messages: [response, ...toolMessages],
      collectedInfo: updatedInfo,
      phase: "planning",
      interruptMessage: `已收集到以下信息：\n\n${summary}\n\n确认无误请回复"确认"，或告诉我需要补充的信息。`,
    };
  }

  return {
    messages: [response, ...toolMessages],
    collectedInfo: updatedInfo,
  };
}
