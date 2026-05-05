import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { amapCache } from "../../lib/cache";
import { withRetry, fetchWithTimeout } from "../../lib/fetch-utils";

const apiKey = process.env.AMAP_API_KEY;

export const searchAttractions = tool(
  async ({ keyword, city }: { keyword?: string; city: string }) => {
    if (!apiKey) return "错误：未设置 AMAP_API_KEY 环境变量。";

    const kw = (keyword || "景点").trim();
    const cacheKey = `attractions:${city.trim()}:${kw}`;
    const cached = amapCache.get(cacheKey);
    if (cached !== null) return `(缓存命中)\n${cached}`;

    const params = new URLSearchParams({
      keywords: kw,
      city: city.trim(),
      types: "1000",
      key: apiKey,
      output: "json",
    });

    try {
      const data = await withRetry(async () => {
        const res = await fetchWithTimeout(
          `https://restapi.amap.com/v3/place/text?${params.toString()}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as {
          status: string;
          pois?: Array<{
            name: string;
            address?: string;
            type?: string;
            location: string;
            tel?: string;
          }>;
        };
      });

      if (data.status !== "1" || !data.pois?.length) {
        const result = `未找到 "${city}" 中与 "${kw}" 相关的景点。`;
        amapCache.set(cacheKey, result);
        return result;
      }

      const results = data.pois
        .slice(0, 10)
        .map(
          (poi, i) =>
            `${i + 1}. **${poi.name}**\n  地址: ${poi.address || "无"}\n  经纬度: ${poi.location}`,
        )
        .join("\n\n");

      const result = `找到 ${data.pois.length} 个景点，显示前 10 个：\n\n${results}`;
      amapCache.set(cacheKey, result);
      return result;
    } catch (error) {
      return `搜索景点失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "search_attractions",
    description: "在指定城市搜索景点风景区。",
    schema: z.object({
      keyword: z.string().describe("景点关键词，如 鼓浪屿、故宫"),
      city: z.string().describe("城市名称，如 厦门、北京"),
    }),
  },
);

export const searchNearby = tool(
  async ({
    location,
    type,
  }: {
    location: string;
    type: "hotel" | "restaurant";
  }) => {
    if (!apiKey) return "错误：未设置 AMAP_API_KEY 环境变量。";

    const cacheKey = `nearby:${location.trim()}:${type}`;
    const cached = amapCache.get(cacheKey);
    if (cached !== null) return `(缓存命中)\n${cached}`;

    const typeCode = type === "hotel" ? "140000" : "050000";
    const params = new URLSearchParams({
      location: location.trim(),
      types: typeCode,
      radius: "3000",
      key: apiKey,
      output: "json",
    });

    try {
      const data = await withRetry(async () => {
        const res = await fetchWithTimeout(
          `https://restapi.amap.com/v3/place/around?${params.toString()}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as {
          status: string;
          pois?: Array<{
            name: string;
            address?: string;
            tel?: string;
            distance: string;
          }>;
        };
      });

      if (data.status !== "1" || !data.pois?.length) {
        const typeName = type === "hotel" ? "酒店" : "餐厅";
        return `该位置周边未找到 ${typeName}。`;
      }

      const typeName = type === "hotel" ? "酒店" : "餐厅";
      const results = data.pois
        .slice(0, 10)
        .map(
          (poi, i) =>
            `${i + 1}. **${poi.name}**\n  地址: ${poi.address || "无"}\n  距离: ${poi.distance}米`,
        )
        .join("\n\n");

      const result = `找到 ${data.pois.length} 个周边${typeName}：\n\n${results}`;
      amapCache.set(cacheKey, result);
      return result;
    } catch (error) {
      return `搜索失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "search_nearby",
    description: "搜索指定位置周边的酒店或餐厅。location 格式为 经度,纬度",
    schema: z.object({
      location: z.string().describe('经纬度，格式 "经度,纬度"，如 "118.06,24.44"'),
      type: z.enum(["hotel", "restaurant"]).describe("hotel 或 restaurant"),
    }),
  },
);
