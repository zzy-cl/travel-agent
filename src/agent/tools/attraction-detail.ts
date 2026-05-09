// src/agent/tools/attraction-detail.ts
// 景点深度信息查询工具 — 通过 SearXNG 搜索景点的文化/历史/门票信息
//
// ── 与 search_attractions 的区别 ──
// - search_attractions: 查景点列表（名称、地址、经纬度）→ "有哪些景点"
// - get_attraction_detail: 查景点深度信息（历史、文化、门票）→ "景点的详情"
//
// ── 并行查询优化 ──
// 对于多个字段（如同时查历史+门票），使用 Promise.all 并行发起搜索，
// 而不是逐个串行。这可以将 5 次搜索的时间从 ~10s 缩短到 ~3s。

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { fetchWithTimeout, withRetry } from "../../lib/fetch-utils";

const attractionDetailSchema = z.object({
  name: z.string().describe("景点名称"),
  fields: z
    .array(z.enum(["history", "culture", "builtDate", "hours", "tickets"]))
    .optional()
    .describe("需要查询的信息字段，不填则返回全部"),
});

/**
 * 查询景点的多个维度信息。
 *
 * 每个字段用独立的 SearXNG 搜索（如"故宫 历史由来"），
 * 多个字段并行执行以提升速度。
 */
async function fetchAttractionDetail(name: string, fields?: string[]): Promise<string> {
  const requestedFields = fields || ["history", "culture", "builtDate", "hours", "tickets"];
  const fieldDescriptions: Record<string, string> = {
    history: "历史由来",
    culture: "人文故事",
    builtDate: "建造日期",
    hours: "开放时间",
    tickets: "门票价格",
  };

  const parts: string[] = [`## ${name}`];

  const searxngUrl = process.env.SEARXNG_BASE_URL || "https://searxng.zhaozeyu.top";

  // 并行查询所有字段（Promise.all 等待所有请求完成）
  const fieldResults = await Promise.all(
    requestedFields.map(async (field) => {
      const label = fieldDescriptions[field] || field;
      try {
        const searchQuery = `${name} ${label}`;
        const data = await withRetry(async () => {
          const res = await fetchWithTimeout(
            `${searxngUrl}/search?q=${encodeURIComponent(searchQuery)}&format=json&categories=general&language=zh`,
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<{ results?: Array<{ snippet?: string; content?: string }> }>;
        });
        // SearXNG 返回 snippet 或 content 字段（取决于引擎）
        const snippet = data?.results?.[0]?.snippet || data?.results?.[0]?.content;
        return snippet ? `### ${label}\n${snippet}` : `### ${label}\n暂无相关信息`;
      } catch {
        return `### ${label}\n查询失败`;
      }
    }),
  );

  for (let i = 0; i < fieldResults.length; i++) {
    parts.push(fieldResults[i]);
  }

  return parts.join("\n\n");
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
      "查询景点的深度文化信息，包括历史由来、人文故事、建造日期、开放时间、门票价格。基于搜索引擎获取，适合了解景点背景。与 search_attractions 不同：本工具查深度信息（历史/文化），search_attractions 查景点列表（名称/地址/经纬度）。",
    schema: attractionDetailSchema,
  },
);
