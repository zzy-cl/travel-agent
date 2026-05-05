import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { cache } from "../../lib/cache";
import { fetchWithTimeout, withRetry } from "../../lib/fetch-utils";

const attractionDetailSchema = z.object({
  name: z.string().describe("景点名称"),
  fields: z
    .array(z.enum(["history", "culture", "builtDate", "hours", "tickets"]))
    .optional()
    .describe("需要查询的信息字段，不填则返回全部"),
});

async function fetchAttractionDetail(
  name: string,
  fields?: string[],
): Promise<string> {
  const cacheKey = `attraction:${name}:${(fields || []).sort().join(",")}`;
  const cached = cache.get<string>(cacheKey);
  if (cached) return cached;

  const requestedFields = fields || ["history", "culture", "builtDate", "hours", "tickets"];
  const fieldDescriptions: Record<string, string> = {
    history: "历史由来",
    culture: "人文故事",
    builtDate: "建造日期",
    hours: "开放时间",
    tickets: "门票价格",
  };

  const parts: string[] = [`## ${name}`];
  for (const field of requestedFields) {
    const label = fieldDescriptions[field] || field;
    try {
      const searchQuery = `${name} ${label}`;
      const searxngUrl = process.env.SEARXNG_URL || "http://localhost:8080";
      const data = await withRetry(async () => {
        const res = await fetchWithTimeout(
          `${searxngUrl}/search?q=${encodeURIComponent(searchQuery)}&format=json&categories=general&language=zh`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ results?: Array<{ snippet?: string }> }>;
      });
      const snippet = data?.results?.[0]?.snippet || "暂无相关信息";
      parts.push(`### ${label}\n${snippet}`);
    } catch {
      parts.push(`### ${label}\n暂无相关信息`);
    }
  }

  const result = parts.join("\n\n");
  cache.set(cacheKey, result, 24 * 3600); // Cache 24 hours
  return result;
}

export const getAttractionDetail = tool(
  async ({ name, fields }: z.infer<typeof attractionDetailSchema>) => {
    try {
      return await fetchAttractionDetail(name, fields);
    } catch {
      return `查询景点「${name}」的详细信息失败，请稍后重试`;
    }
  },
  {
    name: "get_attraction_detail",
    description:
      "查询景点的深度信息，包括历史由来、人文故事、建造日期、开放时间、门票价格。用于为用户提供景点的文化背景介绍。",
    schema: attractionDetailSchema,
  },
);
