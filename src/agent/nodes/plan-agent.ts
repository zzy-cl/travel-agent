import { AIMessage, ToolMessage, HumanMessage } from "@langchain/core/messages";
import { model } from "../../lib/llm";
import type { AgentStateType } from "../state";
import { buildPlanSystemPrompt } from "../prompts/plan";
import { planTools } from "../tools";
import { extractAndCleanText } from "../../lib/tool-call-utils";
import type { ToolInput } from "../../lib/types";
import { extractTextContent, mergeCollectedInfo, stringifyToolResult } from "../../lib/agent-utils";

const modelWithPlanTools = model.bindTools(planTools);

export async function planAgent(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const systemPrompt = buildPlanSystemPrompt(state.collectedInfo, state.tripStatus);
  const messages = [{ role: "system", content: systemPrompt }, ...state.messages];

  let response = await modelWithPlanTools.invoke(messages);

  // Track collectedInfo updates from update_collected_info tool calls, seeded from current state
  let collectedInfoUpdates: AgentStateType["collectedInfo"] | null = { ...state.collectedInfo };

  // Tool call loop with dead-loop protection and data completeness check
  let rounds = 0;
  const MAX_ROUNDS = 5;
  const calledTools = new Set<string>();

  while (AIMessage.isInstance(response) && (response.tool_calls?.length ?? 0) > 0) {
    rounds++;
    const toolCalls = response.tool_calls!;
    const hasSubmitPlan = toolCalls.some((tc) => tc.name === "submit_plan");

    // Soft constraint: if LLM tries to submit_plan without searching first, execute other tools first
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

        // Execute non-submit tools from this batch first
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

        // Add a tool_result for the skipped submit_plan to keep message history valid
        if (submitTc) {
          preToolMessages.push(
            new ToolMessage({
              content: `submit_plan 被暂缓执行。请先完成以下搜索：${missing.join("、")}。完成后可再次调用 submit_plan。`,
              tool_call_id: submitTc.id ?? "",
              name: "submit_plan",
            }),
          );
        }

        response = await modelWithPlanTools.invoke([
          ...messages,
          response,
          ...preToolMessages,
          new HumanMessage({
            content: `建议先用 ${missing.join("、")} 获取实时数据，再提交计划。如果工具失败，用已有知识继续，不要重试。如果你已有足够信息，可以直接调用 submit_plan。`,
          }),
        ]);
        continue;
      }
    }

    // Execute all tool calls
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
        toolMessages.push(
          new ToolMessage({
            content: `未知工具: ${tc.name}`,
            tool_call_id: tc.id ?? "",
            name: tc.name,
          }),
        );
      }
    }

    // submit_plan was called — plan is ready
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

    // Dead-loop protection: force submit after MAX_ROUNDS
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

      // If LLM still won't call submit_plan, use text response as plan
      // Build tool_result messages for any tool_use blocks in forceResponse
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

    // Continue loop — get next response from LLM
    response = await modelWithPlanTools.invoke([...messages, response, ...toolMessages]);
  }

  // Normal loop exit — LLM responded without tool calls.
  // DeepSeek may still embed update_collected_info JSON as plain text in the response.
  const responseText = AIMessage.isInstance(response) ? extractTextContent(response) : "";

  const { textCalls, cleanText } = extractAndCleanText(responseText);

  if (textCalls.length > 0) {
    for (const tc of textCalls) {
      if (tc.name === "update_collected_info") {
        collectedInfoUpdates = mergeCollectedInfo(collectedInfoUpdates!, tc.args);
      }
    }
    // Use cleaned text (JSON stripped) for display
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
