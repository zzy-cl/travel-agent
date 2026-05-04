import { z } from "zod";

export const collectedInfoSchema = z.object({
  destination: z.string().optional().describe("目的地，如 云南、厦门"),
  days: z.number().optional().describe("旅行天数"),
  people: z.number().optional().describe("同行人数"),
  dateRange: z.string().optional().describe("出行日期，如 五一假期、下周末"),
  budget: z.string().optional().describe("预算，如 5000左右"),
  preferences: z
    .array(z.string())
    .default([])
    .describe("偏好列表，如 自然风光、海鲜、人文历史"),
  constraints: z
    .array(z.string())
    .default([])
    .describe("特殊约束，如 有老人、不吃辣、有小孩"),
});

export type CollectedInfo = z.infer<typeof collectedInfoSchema>;
