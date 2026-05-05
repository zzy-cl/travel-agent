import { AIMessage, ToolMessage, HumanMessage } from "@langchain/core/messages";
import { model } from "../../lib/llm";
import type { AgentStateType } from "../state";
import { buildPlanSystemPrompt } from "../prompts/plan";
import { planTools } from "../tools";
const modelWithPlanTools = model.bindTools(planTools);

export async function callPlanAgent(
  state: AgentStateType,
): Promise<Partial<AgentStateType>> {
  const systemPrompt = buildPlanSystemPrompt(state.collectedInfo, state.tripStatus);
  const messages = [{ role: "system", content: systemPrompt }, ...state.messages];

  let response = await modelWithPlanTools.invoke(messages);

  // Tool call loop with dead-loop protection (Bug #2 fix)
  let rounds = 0;
  const MAX_ROUNDS = 8;

  while (
    AIMessage.isInstance(response) &&
    (response.tool_calls?.length ?? 0) > 0
  ) {
    rounds++;
    const allMessages = [...messages, response];

    // Check if submit_plan is among the tool calls — if so, execute and return
    const hasSubmitPlan = response.tool_calls!.some(
      (tc) => tc.name === "submit_plan",
    );

    // Execute all tool calls
    const toolMessages: ToolMessage[] = [];
    for (const tc of response.tool_calls!) {
      const tool = planTools.find((t) => t.name === tc.name);
      if (tool) {
        try {
          // tc.args is Record<string, any> from LangChain, cast needed for typed tool.invoke()
          const result = await tool.invoke(tc.args as any);
          toolMessages.push(
            new ToolMessage({
              content: typeof result === "string" ? result : JSON.stringify(result),
              tool_call_id: tc.id!,
              name: tc.name,
            }),
          );
        } catch {
          toolMessages.push(
            new ToolMessage({
              content: `工具 ${tc.name} 执行失败`,
              tool_call_id: tc.id!,
              name: tc.name,
            }),
          );
        }
      } else {
        toolMessages.push(
          new ToolMessage({
            content: `未知工具: ${tc.name}`,
            tool_call_id: tc.id!,
            name: tc.name,
          }),
        );
      }
    }

    // submit_plan was called — plan is ready
    if (hasSubmitPlan) {
      const planMarkdown = toolMessages.find(
        (m) => m.name === "submit_plan",
      )?.content;
      const msg = `旅行计划已生成！请查看上方内容。你可以：\n- 说"没问题"保存计划\n- 说修改意见，如"第二天换成海边景点"`;
      return {
        messages: [response, ...toolMessages],
        phase: "confirming",
        interruptMessage: msg,
        ...(planMarkdown ? { planMarkdown: String(planMarkdown) } : {}),
      };
    }

    // Dead-loop protection (Bug #2 fix): force submit after MAX_ROUNDS
    if (rounds >= MAX_ROUNDS) {
      const forceResponse = await modelWithPlanTools.invoke([
        ...allMessages,
        ...toolMessages,
        new HumanMessage({
          content:
            "你已经搜索了足够多的信息。请立刻调用 submit_plan 工具提交旅行计划，不要再搜索或调用其他工具。",
        }),
      ]);

      if (
        AIMessage.isInstance(forceResponse) &&
        forceResponse.tool_calls?.some((tc) => tc.name === "submit_plan")
      ) {
        const submitTc = forceResponse.tool_calls.find(
          (tc) => tc.name === "submit_plan",
        )!;
        const submitTool = planTools.find((t) => t.name === "submit_plan")!;
        // tc.args is Record<string, any> from LangChain, cast needed for typed tool.invoke()
        const result = await submitTool.invoke(submitTc.args as any);
        const msg = `旅行计划已生成！请查看上方内容。你可以：\n- 说"没问题"保存计划\n- 说修改意见`;
        return {
          messages: [response, ...toolMessages, forceResponse],
          phase: "confirming",
          interruptMessage: msg,
          planMarkdown: typeof result === "string" ? result : JSON.stringify(result),
        };
      }

      // If LLM still won't call submit_plan, use text response as plan
      const fallbackContent = AIMessage.isInstance(forceResponse)
        ? (typeof forceResponse.content === "string"
            ? forceResponse.content
            : Array.isArray(forceResponse.content)
              ? forceResponse.content
                  .filter((b): b is { type: "text"; text: string } => b.type === "text")
                  .map((b) => b.text)
                  .join("")
              : "")
        : "";
      const msg = fallbackContent
        ? `旅行计划已生成！请查看上方内容。`
        : `抱歉，计划生成遇到了问题。请告诉我更多关于你的偏好，我会重新规划。`;
      return {
        messages: [response, ...toolMessages, forceResponse],
        phase: "confirming",
        interruptMessage: msg,
        ...(fallbackContent ? { planMarkdown: fallbackContent } : {}),
      };
    }

    // Continue loop — get next response from LLM
    response = await modelWithPlanTools.invoke([
      ...allMessages,
      ...toolMessages,
    ]);
  }

  // LLM responded without tool calls — shouldn't normally happen in planning phase
  return { messages: [response] };
}
