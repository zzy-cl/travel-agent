// src/lib/llm.ts
// env 加载 — 确保 .env.local 优先于系统环境变量
import "dotenv/config";
import dotenv from "dotenv";
import path from "path";

dotenv.config({
  path: path.resolve(process.cwd(), ".env.local"),
  override: true,
});

import { ChatAnthropic } from "@langchain/anthropic";

const baseURL =
  process.env.ANTHROPIC_BASE_URL || "https://api.deepseek.com/anthropic";

export const model = new ChatAnthropic({
  model: process.env.LLM_MODEL || "deepseek-v4-pro",
  anthropicApiUrl: baseURL,
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxTokens: 8192,
  thinking:
    process.env.LLM_THINKING === "false"
      ? { type: "disabled" as const }
      : { type: "enabled" as const, budget_tokens: 10240 },
  temperature: process.env.LLM_THINKING === "false" ? undefined : 1,
});
