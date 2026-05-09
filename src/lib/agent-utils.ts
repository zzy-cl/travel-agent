// src/lib/agent-utils.ts
// Agent 节点共享的工具函数
//
// info_collector 和 plan_agent 两个节点都需要处理 LLM 响应、合并用户信息，
// 这里提取为共享函数避免重复代码。
//
// ── 核心函数 ──
// - stringifyToolResult: 将工具执行结果转为字符串（ToolMessage 要求 string）
// - extractTextContent: 从 AIMessage 中提取纯文本
// - mergeCollectedInfo: 合并用户信息更新到当前状态

import type { AIMessage } from "@langchain/core/messages";
import type { CollectedInfo } from "../schemas/collected-info";
import { collectedInfoSchema } from "../schemas/collected-info";

/**
 * 将工具执行结果转为字符串。
 *
 * 为什么需要这个: LangChain 的 ToolMessage.content 必须是 string，
 * 但工具返回值可能是对象（如搜索结果数组）。这里统一转换。
 */
export function stringifyToolResult(result: unknown): string {
  return typeof result === "string" ? result : JSON.stringify(result);
}

/**
 * LangChain 的 text content block 类型。
 *
 * AIMessage.content 有两种格式:
 * - 简单字符串: "你好"
 * - content block 数组: [{ type: "text", text: "你好" }, { type: "thinking", thinking: "..." }]
 *
 * 后者用于 thinking 模式，LLM 会同时返回思考过程和最终文本。
 */
interface TextBlock {
  type: "text";
  text: string;
}

/** 类型守卫: 判断一个对象是否为 LangChain 的 text content block */
export function isTextBlock(block: unknown): block is TextBlock {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as TextBlock).type === "text" &&
    typeof (block as TextBlock).text === "string"
  );
}

/**
 * 从 AIMessage 中提取纯文本内容。
 *
 * 处理两种 content 格式:
 * - string → 直接返回
 * - content block array → 过滤出 type="text" 的块，拼接
 */
export function extractTextContent(message: AIMessage): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(isTextBlock)
      .map((b) => b.text)
      .join("");
  }
  return "";
}

/**
 * 合并 collectedInfo 的部分更新到当前状态。
 *
 * 使用场景: LLM 调用 update_collected_info 工具时，传入的是部分字段（如只更新 destination），
 * 需要与已有的 collectedInfo 合并，而不是整体替换。
 *
 * 特殊处理:
 * - highlights: 按 label 去重（相同 label 保留最新），新条目追加
 * - 空数组: 跳过，避免覆盖已有的 preferences/constraints
 * - 使用 Zod safeParse 校验输入，不合法则忽略更新
 */
export function mergeCollectedInfo(current: CollectedInfo, args: unknown): CollectedInfo {
  const parsed = collectedInfoSchema.partial().safeParse(args);
  if (!parsed.success) return current;
  const raw = parsed.data;

  // highlights 合并逻辑: 按 label 去重，保留最新值
  const mergedHighlights = [...(current.highlights ?? [])];
  if (raw.highlights?.length) {
    for (const hl of raw.highlights) {
      const idx = mergedHighlights.findIndex((h) => h.label === hl.label);
      if (idx >= 0) {
        mergedHighlights[idx] = hl; // 相同 label 覆盖
      } else {
        mergedHighlights.push(hl); // 新 label 追加
      }
    }
  }

  // 标量字段和简单数组的合并（跳过 highlights，已单独处理；跳过空数组）
  const scalarUpdates = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => {
      if (v === undefined) return false;
      if (Array.isArray(v)) {
        if (v.length === 0) return false;
        // highlights 数组已在上面单独处理，这里跳过
        if (v.length > 0 && typeof v[0] === "object" && v[0] !== null && "label" in v[0])
          return false;
      }
      return true;
    }),
  );

  return {
    ...current,
    ...scalarUpdates,
    highlights: mergedHighlights,
    preferences: scalarUpdates.preferences ?? current.preferences,
    constraints: scalarUpdates.constraints ?? current.constraints,
  } as CollectedInfo;
}
