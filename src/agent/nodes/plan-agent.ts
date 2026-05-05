import { AIMessage } from "@langchain/core/messages";
import { model } from "../../lib/llm";
import type { AgentStateType } from "../state";
import { buildPlanSystemPrompt } from "../prompts/plan";
import {
  searchAttractions,
  searchNearby,
  getWeather,
  webSearch,
  submitPlan,
} from "../tools";

const planTools = [searchAttractions, searchNearby, getWeather, webSearch, submitPlan];
const modelWithPlanTools = model.bindTools(planTools);

export async function callPlanAgent(
  state: AgentStateType,
): Promise<Partial<AgentStateType>> {
  const systemPrompt = buildPlanSystemPrompt(state.collectedInfo);
  const messages = [{ role: "system", content: systemPrompt }, ...state.messages];

  let response = await modelWithPlanTools.invoke(messages);

  // 死循环保护：最多 8 轮工具调用
  let lastHumanIdx = -1;
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i]?.getType() === "human") {
      lastHumanIdx = i;
      break;
    }
  }
  const toolCallRounds = state.messages
    .slice(lastHumanIdx + 1)
    .filter((m) => AIMessage.isInstance(m) && (m.tool_calls?.length ?? 0) > 0)
    .length;

  if (
    toolCallRounds > 8 &&
    AIMessage.isInstance(response) &&
    (response.tool_calls?.length ?? 0) > 0
  ) {
    response = await modelWithPlanTools.invoke([
      ...messages,
      response,
      {
        role: "user",
        content: "你已经调用了足够多的工具。请立刻基于已有信息输出最终回复，不要再调用任何工具。",
      },
    ]);
  }

  return { messages: [response] };
}
