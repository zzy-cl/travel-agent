// src/agent/tools/update-info.ts
// 更新旅行信息工具 — 透传工具
//
// ── 什么是"透传工具"？──
// 这个工具不调用任何外部 API。它只是:
// 1. 接收 LLM 提取的旅行信息（如 { destination: "北京", days: 3 }）
// 2. 原样返回 JSON 字符串
//
// 真正的"信息合并"逻辑在 info-collector.ts 的 mergeCollectedInfo() 中完成。
// 工具本身只是一个"钩子"，让 LLM 有地方输出结构化数据。
//
// ── 为什么 info_collector 和 plan_agent 都用这个工具？──
// - info_collector: 收集阶段提取信息
// - plan_agent: 生成阶段可能发现用户想修改信息（如"把预算改成 8000"）

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { collectedInfoSchema } from "../../schemas/collected-info";

export const updateCollectedInfo = tool(
  async (info: Partial<z.infer<typeof collectedInfoSchema>>) => {
    // 透传: 直接返回 JSON，实际合并逻辑在节点中
    return JSON.stringify(info);
  },
  {
    name: "update_collected_info",
    description:
      "从用户的回复中提取旅行相关信息并更新。每次用户回答了问题都应该调用此工具来记录提取到的信息。只传有新信息的字段。",
    schema: collectedInfoSchema.partial(), // .partial() 所有字段可选（只更新传入的字段）
  },
);
