// src/lib/tool-call-utils.ts
// DeepSeek text-embedded tool call 处理
//
// ── 问题背景 ──
// DeepSeek 通过 Anthropic-compatible API 调用时，偶尔会把 tool_calls 以纯文本 JSON
// 的形式嵌入到 AIMessage.content 中，而不是使用标准的 tool_use content block。
//
// 例如 LLM 可能返回:
//   content: "好的，我来记录信息 {\"destination\":\"北京\",\"days\":3}"
//
// 而不是:
//   tool_calls: [{ name: "update_collected_info", args: { destination: "北京", days: 3 } }]
//
// ── 解决方案 ──
// extractAndCleanText 扫描文本末尾的 JSON 对象，如果包含 collectedInfo 的特征字段
// （如 destination、days、people），就将其提取为伪 tool_call，同时从文本中移除 JSON。
//
// 这是一个典型的 "defensive programming"（防御性编程）案例:
// 不依赖 LLM 的输出格式 100% 符合规范，而是做好降级处理。

/** collectedInfo 的特征字段，用于识别文本中的 update_collected_info 调用 */
export const INFO_KEYS = [
  "destination",
  "days",
  "people",
  "budget",
  "dateRange",
  "preferences",
  "constraints",
  "transport",
  "accommodation",
  "highlights",
];

/**
 * 从 LLM 纯文本响应中提取嵌入的 tool call JSON，并返回清理后的文本。
 *
 * 工作原理:
 * 1. 用正则找到文本中所有 JSON 对象
 * 2. 从末尾开始检查（最新的 tool call 在最后）
 * 3. 如果 JSON 的 keys 包含 collectedInfo 特征字段 → 提取为 tool call
 * 4. 如果 JSON 为空对象 {} → 可能是 confirm_info
 * 5. 从原始文本中移除已识别的 JSON
 *
 * 返回:
 * - textCalls: 提取出的伪 tool calls
 * - cleanText: 移除 JSON 后的干净文本（展示给用户）
 */
export function extractAndCleanText(rawText: string): {
  textCalls: Array<{ name: string; args: unknown }>;
  cleanText: string;
} {
  const textCalls: Array<{ name: string; args: unknown }> = [];

  // 正则匹配独立的 JSON 对象（支持嵌套）
  const jsonPattern = /\{(?:[^{}]|"(?:[^"\\]|\\.)*"|\{(?:[^{}]|"(?:[^"\\]|\\.)*")*\})*\}/g;
  const matches = [...rawText.matchAll(jsonPattern)];

  let cleanText = rawText;

  // 从后往前处理（末尾的 JSON 最可能是 tool call）
  const reversed = [...matches].reverse();
  for (const m of reversed) {
    try {
      const parsed = JSON.parse(m[0]);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const keys = Object.keys(parsed);
        // 检查是否为 update_collected_info 调用（含特征字段）
        if (keys.some((k) => INFO_KEYS.includes(k))) {
          textCalls.push({ name: "update_collected_info", args: parsed });
          cleanText = cleanText.replace(m[0], "").trim();
        } else if (keys.length === 0) {
          // 空对象 → 可能是 confirm_info
          textCalls.push({ name: "confirm_info", args: {} });
          cleanText = cleanText.replace(m[0], "").trim();
        }
        // 只处理最后一个 tool-call-like JSON（避免误识别用户文本中的 JSON）
        if (textCalls.length > 0) break;
      }
    } catch {
      // JSON 解析失败 → 不是 tool call，保留原样
    }
  }

  // 清理移除 JSON 后留下的多余空行
  cleanText = cleanText.replace(/\n{3,}/g, "\n\n").trim();

  return { textCalls, cleanText };
}
