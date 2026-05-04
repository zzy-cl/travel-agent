import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { withRetry, fetchWithTimeout } from "../../lib/fetch-utils";

const BASE_URL =
  process.env.SEARXNG_BASE_URL || "https://searxng.zhaozeyu.top";

export const webSearch = tool(
  async ({ query, count = 10 }: { query: string; count?: number }) => {
    const params = new URLSearchParams({
      q: query.trim(),
      count: count.toString(),
      format: "json",
    });

    try {
      const data = await withRetry(async () => {
        const res = await fetchWithTimeout(
          `${BASE_URL}/search?${params.toString()}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as {
          results: Array<{
            title: string;
            url: string;
            content?: string;
          }>;
        };
      });

      if (!data.results?.length) return "没有找到相关搜索结果。";

      return data.results
        .slice(0, count)
        .map(
          (r, i) =>
            `${i + 1}. **${r.title}**\n   URL: ${r.url}\n   摘要: ${r.content || "无"}`,
        )
        .join("\n\n");
    } catch (error) {
      return `搜索失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "web_search",
    description: "搜索网页获取最新信息，如景点门票价格、开放时间、网友评价等。",
    schema: z.object({
      query: z.string().describe("搜索关键词"),
      count: z.number().min(1).max(20).optional().default(10).describe("结果数量"),
    }),
  },
);
