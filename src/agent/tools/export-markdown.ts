import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const exportMarkdown = tool(
  ({ planMarkdown, includeAttractionDetails }: { planMarkdown: string; includeAttractionDetails?: boolean }) => {
    if (!planMarkdown) return "没有可导出的行程";

    let output = planMarkdown;
    if (includeAttractionDetails) {
      output += "\n\n---\n\n> 景点详细信息已包含在行程中";
    }

    return output;
  },
  {
    name: "export_markdown",
    description: "将旅行计划导出为 Markdown 格式",
    schema: z.object({
      planMarkdown: z.string().describe("行程的 Markdown 内容"),
      includeAttractionDetails: z.boolean().optional().describe("是否包含景点详细信息"),
    }),
  },
);
