import { toolRegistry } from "./registry";
import { z } from "zod";

// Import tool implementations
import { getWeather } from "./weather";
import { webSearch } from "./search";
import { submitPlan } from "./submit-plan";
import { getAttractionDetail } from "./attraction-detail";

// ── Tool Registry ──

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
  cacheTTL: 0,
});

// Export LangChain-compatible tools for graph nodes
export const planTools = toolRegistry.toLangChainTools();

// Direct exports for node usage
export { confirmInfo } from "./confirm-info";
export { updateCollectedInfo } from "./update-info";
