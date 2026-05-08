import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { withRetry, fetchWithTimeout } from "../../lib/fetch-utils";

const AMAP_API_URL = "https://restapi.amap.com/v3/place";

interface AmapPOI {
  name: string;
  address?: string;
  type?: string;
  location: string; // "lng,lat"
  tel?: string;
}

interface AmapSearchResponse {
  status: string;
  pois?: AmapPOI[];
}

interface AmapNearbyPOI {
  name: string;
  address?: string;
  tel?: string;
  distance: string;
}

interface AmapNearbyResponse {
  status: string;
  pois?: AmapNearbyPOI[];
}

/**
 * Search attractions by keyword in a city.
 * Uses Amap POI text search, filtered to scenic spots (type 1000).
 */
export const searchAttractions = tool(
  async ({ keyword, city }: { keyword: string; city: string }) => {
    const apiKey = process.env.AMAP_API_KEY;
    if (!apiKey) {
      return "错误：未设置 AMAP_API_KEY 环境变量。请前往 https://lbs.amap.com/ 获取 API Key。";
    }

    const cleanKeyword = keyword.trim();
    const cleanCity = city.trim();

    const params = new URLSearchParams({
      keywords: cleanKeyword,
      city: cleanCity,
      types: "100000|080000|110000", // 风景名胜 | 博物馆/展览馆 | 公园
      key: apiKey,
      output: "json",
    });

    try {
      const data = await withRetry(async () => {
        const res = await fetchWithTimeout(`${AMAP_API_URL}/text?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as AmapSearchResponse;
      });

      if (data.status !== "1") {
        return `高德 API 调用失败（status=${data.status}），请检查 API Key 是否有效或稍后重试。`;
      }
      if (!data.pois?.length) {
        return `未找到城市 "${cleanCity}" 中与 "${cleanKeyword}" 相关的景点。`;
      }

      const results = data.pois
        .slice(0, 10)
        .map(
          (poi, i) =>
            `${i + 1}. **${poi.name}**
  地址: ${poi.address || "无"}
  类型: ${poi.type || "景点"}
  经纬度: ${poi.location}${poi.tel ? `\n  电话: ${poi.tel}` : ""}`,
        )
        .join("\n\n");

      return `找到 ${data.pois.length} 个景点，显示前 10 个：\n\n${results}`;
    } catch (error) {
      return `搜索景点失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "search_attractions",
    description:
      "在指定城市搜索景点风景区（基于高德地图 POI 数据）。返回景点名称、地址、经纬度、电话。返回的经纬度可直接传给 search_nearby 工具搜索该景点周边的酒店和餐厅。适合在规划初期了解目的地有哪些景点。",
    schema: z.object({
      keyword: z.string().describe("景点关键词，如：鼓浪屿、故宫、西湖"),
      city: z.string().describe("城市名称，如：厦门、北京、杭州"),
    }),
  },
);

/**
 * Search nearby hotels or restaurants around a location.
 * Uses Amap POI around search, 3km radius.
 */
export const searchNearby = tool(
  async ({ location, type }: { location: string; type: "hotel" | "restaurant" }) => {
    const apiKey = process.env.AMAP_API_KEY;
    if (!apiKey) {
      return "错误：未设置 AMAP_API_KEY 环境变量。请前往 https://lbs.amap.com/ 获取 API Key。";
    }

    const cleanLocation = location.trim();
    const typeCode = type === "hotel" ? "140000" : "050000";
    const typeName = type === "hotel" ? "酒店" : "餐厅";

    const params = new URLSearchParams({
      location: cleanLocation,
      types: typeCode,
      radius: "3000",
      key: apiKey,
      output: "json",
    });

    try {
      const data = await withRetry(async () => {
        const res = await fetchWithTimeout(`${AMAP_API_URL}/around?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as AmapNearbyResponse;
      });

      if (data.status !== "1") {
        return `高德 API 调用失败（status=${data.status}），请检查 API Key 是否有效或稍后重试。`;
      }
      if (!data.pois?.length) {
        return `该位置周边 3km 内未找到${typeName}。`;
      }

      const results = data.pois
        .slice(0, 10)
        .map(
          (poi, i) =>
            `${i + 1}. **${poi.name}**
  地址: ${poi.address || "无"}${poi.tel ? `\n  电话: ${poi.tel}` : ""}
  距离: ${poi.distance} 米`,
        )
        .join("\n\n");

      return `找到 ${data.pois.length} 个周边${typeName}，显示前 10 个：\n\n${results}`;
    } catch (error) {
      return `搜索周边${typeName}失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "search_nearby",
    description:
      "搜索指定位置周边 3km 内的酒店或餐厅（基于高德地图数据）。location 参数来自 search_attractions 返回的经纬度（格式如 118.06,24.44）。用于为用户推荐景点附近的住宿和餐饮。",
    schema: z.object({
      location: z.string().describe('经纬度，格式 "经度,纬度"，如 "118.06,24.44"'),
      type: z.enum(["hotel", "restaurant"]).describe("hotel=酒店，restaurant=餐厅"),
    }),
  },
);
