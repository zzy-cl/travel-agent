import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { model } from "../../lib/llm";
import type { AgentStateType } from "../state";
import { infoSystemPrompt } from "../prompts/info";
import { confirmInfo, updateCollectedInfo } from "../tools";

const infoTools = [updateCollectedInfo, confirmInfo];
const modelWithInfoTools = model.bindTools(infoTools);

export async function callInfoAgent(
  state: AgentStateType,
): Promise<Partial<AgentStateType>> {
  const messages = [{ role: "system", content: infoSystemPrompt }, ...state.messages];
  const response = await modelWithInfoTools.invoke(messages);
  return { messages: [response] };
}

// 处理 info_tools 返回的 ToolMessage，更新 collectedInfo
export function processInfoToolsResult(
  state: AgentStateType,
): Partial<AgentStateType> {
  // 找到最近的 AI 消息，检查是否有 confirm_info 调用
  let lastAiIdx = -1;
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (AIMessage.isInstance(state.messages[i])) {
      lastAiIdx = i;
      break;
    }
  }

  if (lastAiIdx === -1) return {};

  const aiMsg = state.messages[lastAiIdx] as AIMessage;
  const hasConfirm = aiMsg.tool_calls?.some(
    (tc) => tc.name === "confirm_info",
  );

  // 检查最后的 ToolMessage 中是否有 update_collected_info 的结果
  const lastToolMsg = state.messages.at(-1);
  if (lastToolMsg && ToolMessage.isInstance(lastToolMsg)) {
    // 找到对应的 tool_call args（从 AI 消息中）
    const updateCall = aiMsg.tool_calls?.find(
      (tc) => tc.name === "update_collected_info" && tc.id === lastToolMsg.tool_call_id,
    );

    if (updateCall) {
      const newInfo = updateCall.args as Record<string, unknown>;
      const updates: Partial<AgentStateType> = {
        collectedInfo: {
          ...state.collectedInfo,
          ...newInfo,
          preferences: newInfo.preferences
            ? (newInfo.preferences as string[])
            : state.collectedInfo.preferences,
          constraints: newInfo.constraints
            ? (newInfo.constraints as string[])
            : state.collectedInfo.constraints,
        },
      };

      if (hasConfirm) {
        updates.phase = "planning";
      }

      return updates;
    }
  }

  if (hasConfirm) {
    return { phase: "planning" };
  }

  return {};
}
