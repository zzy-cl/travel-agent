import { z } from "zod";

export const highlightSchema = z.object({
  label: z.string().describe("信息标签，如 出发地点、必去景点、饮食禁忌、特殊需求"),
  value: z.string().describe("信息内容，如 深圳龙华、长隆野生动物园、不吃辣、女朋友怕晒"),
});

export const collectedInfoSchema = z.object({
  // ── 核心固定字段（plan_agent 工具调用必需）──
  destination: z.string().optional().describe("目的地，如 云南、厦门"),
  days: z.number().optional().describe("旅行天数"),
  people: z.number().optional().describe("同行人数"),
  dateRange: z.string().optional().describe("出行日期，如 五一假期、下周末"),
  budget: z.string().optional().describe("预算，如 5000左右"),
  // ── 辅助固定字段 ──
  transport: z.string().optional().describe("交通方式偏好，如 自驾、公共交通、包车"),
  accommodation: z.string().optional().describe("住宿类型偏好，如 酒店、民宿、青旅"),
  preferences: z.array(z.string()).default([]).describe("偏好列表，如 自然风光、海鲜、人文历史"),
  constraints: z.array(z.string()).default([]).describe("特殊约束，如 有老人、不吃辣、有小孩"),
  // ── 动态亮点字段（LLM 自主提取对话中的任意有价值信息）──
  highlights: z
    .array(highlightSchema)
    .default([])
    .describe(
      "从用户对话中提取的亮点信息。每条包含 label（标签）和 value（内容）。" +
        "例如：{ label: '出发地点', value: '深圳龙华' }、" +
        "{ label: '必去景点', value: '长隆野生动物园' }、" +
        "{ label: '住宿预算', value: '200-300元/晚' }。" +
        "已通过其他固定字段表达的信息（如目的地、天数、人数等）不要再重复放入 highlights。" +
        "相同 label 的亮点只保留最新一条。",
    ),
});

export type CollectedInfo = z.infer<typeof collectedInfoSchema>;
export type Highlight = z.infer<typeof highlightSchema>;
