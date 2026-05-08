// src/lib/llm.ts

import { ChatAnthropic } from "@langchain/anthropic";

const baseURL = process.env.ANTHROPIC_BASE_URL || "https://api.deepseek.com/anthropic";

export const model = new ChatAnthropic({
  model: process.env.LLM_MODEL || "deepseek-v4-pro",
  anthropicApiUrl: baseURL,
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxTokens: 16384,
  thinking:
    process.env.LLM_THINKING === "false"
      ? { type: "disabled" as const }
      : { type: "enabled" as const, budget_tokens: 8192 },
  ...(process.env.LLM_THINKING === "false" ? { temperature: 1 } : {}),
  maxRetries: 3,
});
