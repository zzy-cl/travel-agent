// src/agent/tools/submit-plan.ts
// 提交计划工具 — 透传工具
//
// 这是最简单的透传工具: LLM 生成的 Markdown 计划传入后原样返回。
// 节点检测到 submit_plan 被调用后，就知道计划已生成完毕，
// 将 planMarkdown 存入状态，转到确认阶段。
//
// ── 为什么 planMarkdown 要通过工具返回，而不是直接用 LLM 文本？──
// 1. 结构化: 工具调用有明确的 name + args，比解析纯文本更可靠
// 2. 单次性: prompt 中强调"submit_plan 只调一次"，节点可以检测是否已提交
// 3. 格式保证: schema 中描述了必须包含的章节，引导 LLM 输出完整计划

import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const submitPlan = tool(
  ({ markdown }: { markdown: string }) => {
    // 透传: 直接返回 markdown，节点会提取这个值作为 planMarkdown
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
