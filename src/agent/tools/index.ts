import { toolRegistry } from "./registry";
import { z } from "zod";

// Import tool implementations
import { searchAttractions, searchNearby } from "./amap";
import { getWeather } from "./weather";
import { webSearch } from "./search";
import { submitPlan } from "./submit-plan";
import { getTraffic } from "./traffic";
import { getAttractionDetail } from "./attraction-detail";
import { optimizeRoute } from "./optimize-route";

// Register tools with cache TTLs (in seconds)
// searchAttractions and searchNearby: cache 1 hour
// getWeather: cache 30 minutes
// webSearch, submitPlan, getTraffic, optimizeRoute: no cache
// getAttractionDetail: has its own internal 24h cache

// We register by wrapping the LangChain tool.invoke calls
toolRegistry.register({
  name: "search_attractions",
  description: "搜索目的地的景点",
  schema: z.object({ city: z.string(), keyword: z.string().optional() }),
  execute: async (input) => {
    const result = await searchAttractions.invoke(input);
    return typeof result === "string" ? result : JSON.stringify(result);
  },
  cacheTTL: 3600,
});

toolRegistry.register({
  name: "search_nearby",
  description: "搜索附近的景点和服务",
  schema: z.object({ location: z.string(), type: z.enum(["hotel", "restaurant"]) }),
  execute: async (input) => {
    const result = await searchNearby.invoke(input);
    return typeof result === "string" ? result : JSON.stringify(result);
  },
  cacheTTL: 3600,
});

toolRegistry.register({
  name: "get_weather",
  description: "查询目的地天气预报",
  schema: z.object({ location: z.string(), days: z.number().min(1).max(7).optional().default(1) }),
  execute: async (input) => {
    const result = await getWeather.invoke(input);
    return typeof result === "string" ? result : JSON.stringify(result);
  },
  cacheTTL: 1800,
});

toolRegistry.register({
  name: "web_search",
  description: "网页搜索",
  schema: z.object({ query: z.string(), count: z.number().min(1).max(20).optional().default(10) }),
  execute: async (input) => {
    const result = await webSearch.invoke(input);
    return typeof result === "string" ? result : JSON.stringify(result);
  },
  cacheTTL: 0,
});

toolRegistry.register({
  name: "submit_plan",
  description: "提交最终的旅游计划",
  schema: z.object({ markdown: z.string() }),
  execute: async (input) => {
    const result = await submitPlan.invoke(input);
    return typeof result === "string" ? result : JSON.stringify(result);
  },
  cacheTTL: 0,
});

toolRegistry.register({
  name: "get_traffic",
  description: "查询两个地点之间的实时交通状况",
  schema: z.object({ origin: z.string(), destination: z.string() }),
  execute: async (input) => {
    const result = await getTraffic.invoke(input);
    return typeof result === "string" ? result : JSON.stringify(result);
  },
  cacheTTL: 0,
});

toolRegistry.register({
  name: "get_attraction_detail",
  description: "查询景点的深度信息，包括历史由来、人文故事、建造日期、开放时间、门票价格",
  schema: z.object({
    name: z.string(),
    fields: z.array(z.enum(["history", "culture", "builtDate", "hours", "tickets"])).optional(),
  }),
  execute: async (input) => {
    const result = await getAttractionDetail.invoke(input);
    return typeof result === "string" ? result : JSON.stringify(result);
  },
  cacheTTL: 0, // has its own internal 24h cache
});

toolRegistry.register({
  name: "optimize_route",
  description: "优化多个景点之间的路线，计算每段距离和预计耗时",
  schema: z.object({
    attractions: z.array(z.string()),
    startPoint: z.string(),
    transport: z.enum(["walk", "drive", "transit"]),
    timeConstraint: z.number().optional(),
  }),
  execute: async (input) => {
    const result = await optimizeRoute.invoke(input);
    return typeof result === "string" ? result : JSON.stringify(result);
  },
  cacheTTL: 0,
});

// Export LangChain-compatible tools for graph nodes
export const planTools = toolRegistry.toLangChainTools();

// Direct exports for backward compatibility
export { confirmInfo } from "./confirm-info";
export { updateCollectedInfo } from "./update-info";
export { searchAttractions, searchNearby } from "./amap";
export { getWeather } from "./weather";
export { webSearch } from "./search";
export { submitPlan } from "./submit-plan";
export { getTraffic } from "./traffic";
export { getAttractionDetail } from "./attraction-detail";
export { optimizeRoute } from "./optimize-route";
