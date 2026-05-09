// src/lib/llm.ts
// LLM 模型单例配置
//
// 创建一个全局共享的 ChatAnthropic 实例，供 agent/nodes 中的节点调用。
// ChatAnthropic: LangChain 对 Anthropic Claude API 的封装，兼容 DeepSeek 的 Anthropic-compatible API。
//
// ── 关键配置 ──
// - thinking 模式: 让 LLM 先"思考"再回答，提升推理质量（类似 Claude 的 extended thinking）
// - budget_tokens: 分配给"思考"阶段的 token 预算，越大推理越深入但越慢
// - maxRetries: API 调用失败时自动重试 3 次（指数退避）

import { ChatAnthropic } from "@langchain/anthropic";

// Anthropic-compatible API 的 base URL（DeepSeek/MiMo 等厂商都提供兼容接口）
const baseURL = process.env.ANTHROPIC_BASE_URL || "https://api.deepseek.com/anthropic";

export const model = new ChatAnthropic({
  model: process.env.LLM_MODEL || "deepseek-v4-pro",
  anthropicApiUrl: baseURL,
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxTokens: 16384,
  // thinking: 控制 LLM 的"深度思考"模式
  // - enabled: LLM 会先输出一段思考过程（不展示给用户），再给出最终回答
  // - disabled: 直接回答，速度更快但推理质量略低
  // - 环境变量 LLM_THINKING=false 可关闭（用于生产环境提速）
  thinking:
    process.env.LLM_THINKING === "false"
      ? { type: "disabled" as const }
      : { type: "enabled" as const, budget_tokens: 8192 },
  // temperature: 控制输出随机性（0=确定性，1=创造性）
  // 只在 thinking 关闭时设置（thinking 模式下 temperature 固定为 1）
  ...(process.env.LLM_THINKING === "false" ? { temperature: 1 } : {}),
  maxRetries: 3,
});
