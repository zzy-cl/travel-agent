import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const submitPlan = tool(
  ({ markdown }: { markdown: string }) => {
    return markdown;
  },
  {
    name: "submit_plan",
    description:
      "提交最终的旅游计划。参数 markdown 是完整的旅行计划 Markdown 文本，包含目的地概览、住宿、交通、每日行程、美食、预算、注意事项等章节。",
    schema: z.object({
      markdown: z
        .string()
        .describe(
          "完整的旅行计划 Markdown 文本。必须包含以下章节：\n" +
            "## 目的地概览\n## 住宿推荐\n## 交通建议\n## 每日行程（含表格）\n" +
            "## 特色美食\n## 预算估算（含表格）\n## 注意事项",
        ),
    }),
  },
);
