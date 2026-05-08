import { toolRegistry } from "./registry";
import { z } from "zod";
import { stringifyToolResult } from "../../lib/agent-utils";

// Import tool implementations
import { getWeather } from "./weather";
import { webSearch } from "./search";
import { fetchSearch } from "./fetch";
import { searchAttractions, searchNearby } from "./amap";
import { submitPlan } from "./submit-plan";
import { getAttractionDetail } from "./attraction-detail";
import { updateCollectedInfo } from "./update-info";
import { collectedInfoSchema } from "../../schemas/collected-info";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- LangChain tool.invoke requires specific typed input; Zod schema validates at runtime
type InvokeInput = any;

// ── Tool Registry ──

toolRegistry.register({
  name: "get_weather",
  description: "查询目的地天气预报和空气质量",
  schema: z.object({ location: z.string(), days: z.number().min(1).optional().default(1) }),
  execute: async (input) => stringifyToolResult(await getWeather.invoke(input as InvokeInput)),
});

toolRegistry.register({
  name: "web_search",
  description: "网页搜索",
  schema: z.object({ query: z.string(), count: z.number().min(1).max(20).optional().default(10) }),
  execute: async (input) => stringifyToolResult(await webSearch.invoke(input as InvokeInput)),
});

toolRegistry.register({
  name: "fetch_search",
  description: "获取网页完整内容",
  schema: z.object({ url: z.string() }),
  execute: async (input) => stringifyToolResult(await fetchSearch.invoke(input as InvokeInput)),
});

toolRegistry.register({
  name: "search_attractions",
  description: "搜索城市景点",
  schema: z.object({ keyword: z.string(), city: z.string() }),
  execute: async (input) =>
    stringifyToolResult(await searchAttractions.invoke(input as InvokeInput)),
});

toolRegistry.register({
  name: "search_nearby",
  description: "搜索周边酒店或餐厅",
  schema: z.object({
    location: z.string(),
    type: z.enum(["hotel", "restaurant"]),
  }),
  execute: async (input) => stringifyToolResult(await searchNearby.invoke(input as InvokeInput)),
});

toolRegistry.register({
  name: "update_collected_info",
  description:
    "更新旅行信息。可更新字段：destination(目的地)、days(天数)、people(人数)、dateRange(日期)、budget(预算)、transport(交通方式)、accommodation(住宿偏好)、preferences(偏好数组)、constraints(约束数组)、highlights(亮点数组，每条含label和value。用于捕获固定字段装不下的信息，如 出发地点、必去景点、饮食禁忌、特殊需求)。只传需要更新的字段。",
  schema: collectedInfoSchema.partial(),
  execute: async (input) =>
    stringifyToolResult(await updateCollectedInfo.invoke(input as InvokeInput)),
});

toolRegistry.register({
  name: "submit_plan",
  description: "提交最终的旅游计划",
  schema: z.object({ markdown: z.string() }),
  execute: async (input) => stringifyToolResult(await submitPlan.invoke(input as InvokeInput)),
});

toolRegistry.register({
  name: "get_attraction_detail",
  description: "查询景点深度文化信息（历史/文化/门票/开放时间）",
  schema: z.object({
    name: z.string(),
    fields: z.array(z.enum(["history", "culture", "builtDate", "hours", "tickets"])).optional(),
  }),
  execute: async (input) =>
    stringifyToolResult(await getAttractionDetail.invoke(input as InvokeInput)),
});

// Export LangChain-compatible tools for graph nodes
export const planTools = toolRegistry.toLangChainTools();

// Direct exports for node usage
export { confirmInfo } from "./confirm-info";
export { updateCollectedInfo } from "./update-info";
