import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";

export const model = new ChatOpenAI({
  model: "gpt-4o-mini",
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  },
  temperature: 0.7,
});
