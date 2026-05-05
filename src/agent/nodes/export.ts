import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { interrupt } from "@langchain/langgraph";
import { model } from "../../lib/llm";
import type { AgentStateType } from "../state";
import { exportMarkdown, exportJson } from "../tools";
import type { StructuredTool } from "@langchain/core/tools";

const exportTools: StructuredTool[] = [exportMarkdown, exportJson];
const modelWithExportTools = model.bindTools(exportTools);

export async function exportNode(
  state: AgentStateType,
): Promise<Partial<AgentStateType>> {
  const formatHint = state.messages
    .slice(-1)
    .find((m) => m.getType() === "human")?.content || "";

  const collectedInfoStr = state.collectedInfo
    ? JSON.stringify(state.collectedInfo, null, 2)
    : "暂无";

  const prompt = `用户请求导出旅行计划。

用户已收集的旅行信息：${collectedInfoStr}

当前行程内容如下：

${state.planMarkdown}

用户请求：${formatHint}

请调用合适的导出工具（export_markdown 或 export_json）来生成导出文件。调用 export_json 时，将上面的已收集信息作为 collectedInfo 参数传入。`;

  const response = await modelWithExportTools.invoke([
    { role: "user", content: prompt },
  ]);

  if (!AIMessage.isInstance(response) || !response.tool_calls?.length) {
    return {
      messages: [response],
      phase: "confirming",
    };
  }

  const toolMessages: ToolMessage[] = [];
  let exportedContent = "";

  for (const tc of response.tool_calls) {
    const tool = exportTools.find((t) => t.name === tc.name);
    if (tool) {
      try {
        const result = await tool.invoke(tc.args as any);
        exportedContent = typeof result === "string" ? result : JSON.stringify(result);
        toolMessages.push(
          new ToolMessage({
            content: exportedContent,
            tool_call_id: tc.id!,
            name: tc.name,
          }),
        );
      } catch {
        toolMessages.push(
          new ToolMessage({
            content: `导出失败`,
            tool_call_id: tc.id!,
            name: tc.name,
          }),
        );
      }
    }
  }

  const exportMessage = exportedContent
    ? `导出完成！以下是导出内容：\n\n\`\`\`\n${exportedContent.slice(0, 500)}${exportedContent.length > 500 ? "..." : ""}\n\`\`\``
    : "导出失败，请重试。";

  interrupt(exportMessage);

  return {
    messages: [response, ...toolMessages],
    phase: "confirming",
    interruptMessage: exportMessage,
  };
}
