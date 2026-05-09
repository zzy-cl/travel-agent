// src/agent/tools/confirm-info.ts
// 确认信息工具 — 透传工具
//
// LLM 调用此工具表示"信息收集完毕，可以进入计划生成阶段"。
// 工具本身只返回一个固定字符串，真正的作用是:
// 让 info_collector 节点检测到 confirm_info 被调用，从而触发阶段转换。
//
// 类比: 这就像一个"完成按钮" —— 按钮本身不做任何事，
// 但按下后系统知道该进入下一阶段了。

import { z } from "zod";
import { tool } from "@langchain/core/tools";

export const confirmInfo = tool(
  async () => {
    return "信息已确认，可以开始生成旅行计划了。";
  },
  {
    name: "confirm_info",
    description:
      "当收集到足够的旅行信息后调用此工具，表示信息收集完毕，可以进入计划生成阶段。只在所有关键信息都收集齐全后才调用。",
    schema: z.object({}), // 空参数: 不需要任何输入
  },
);
