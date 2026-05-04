# 智能旅游 Agent 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个引导式渐进旅游规划 Agent，基于 LangGraph 状态机实现多阶段对话流程

**Architecture:** LangGraph StateGraph 管理四阶段流程（信息收集 → 确认 → 计划生成 → 迭代优化），infoAgent 无外部工具纯对话收集信息，planAgent 调用高德/天气/搜索工具生成计划，Next.js API Route 通过 SSE 流式返回

**Tech Stack:** Next.js 16, React 19, Tailwind CSS 4, LangGraph, @langchain/openai, Zod, SSE

---

## 文件结构

```
src/
├── lib/
│   ├── llm.ts                  # ChatOpenAI 实例
│   ├── cache.ts                # LRU 缓存
│   └── fetch-utils.ts          # HTTP 工具函数
├── schemas/
│   ├── collected-info.ts       # collectedInfo Zod schema
│   └── travel-plan.ts          # travelPlan Zod schema + types
├── agent/
│   ├── state.ts                # AgentState Annotation
│   ├── tools/
│   │   ├── confirm-info.ts     # 信息确认信号工具
│   │   ├── update-info.ts      # 信息更新工具
│   │   ├── amap.ts             # 高德地图工具
│   │   ├── weather.ts          # 和风天气工具
│   │   ├── search.ts           # Web 搜索工具
│   │   ├── submit-plan.ts      # 提交计划工具
│   │   └── index.ts            # 统一导出
│   ├── prompts/
│   │   ├── info.ts             # 信息收集 system prompt
│   │   └── plan.ts             # 规划 system prompt
│   ├── nodes/
│   │   ├── router.ts           # 路由节点
│   │   ├── info-agent.ts       # 信息收集 Agent + afterAgent
│   │   ├── plan-agent.ts       # 规划 Agent + afterAgent
│   │   └── save.ts             # 保存节点
│   └── graph.ts                # StateGraph 编译
├── app/
│   ├── api/chat/route.ts       # SSE 流式 API
│   ├── layout.tsx              # 根布局
│   ├── page.tsx                # 主页面
│   └── globals.css             # 全局样式
└── components/
    ├── ChatPanel.tsx            # 聊天面板
    ├── MessageBubble.tsx        # 消息气泡
    ├── InfoSidebar.tsx          # 信息面板
    └── PlanCard.tsx             # 计划卡片
```

---

## Task 1: 依赖安装

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装核心依赖**

```bash
cd "D:/知识学习/travel-agent"
npm install @langchain/langgraph @langchain/core @langchain/openai zod dotenv
```

- [ ] **Step 2: 验证安装**

```bash
npm ls @langchain/langgraph @langchain/core @langchain/openai zod
```

Expected: 各包版本号正常显示，无 peer dependency 警告

- [ ] **Step 3: 创建 .env.local**

```
# .env.local
OPENAI_API_KEY=your-key-here
OPENAI_BASE_URL=https://api.openai.com/v1
AMAP_API_KEY=your-amap-key
QWEATHER_API_KEY=your-qweather-key
SEARXNG_BASE_URL=https://searxng.example.com
```

- [ ] **Step 4: 创建目录结构**

```bash
mkdir -p src/lib src/schemas src/agent/tools src/agent/prompts src/agent/nodes src/app/api/chat src/components
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.local
git commit -m "chore: install langgraph, langchain, zod dependencies"
```

---

## Task 2: lib 基础设施 — cache.ts

**Files:**
- Create: `src/lib/cache.ts`
- Reference: `D:\知识学习\LangChain\src\utils\cache.ts`

- [ ] **Step 1: 创建 LRU 缓存模块**

```typescript
// src/lib/cache.ts

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

export class LRUCache<K, V> {
  private cache = new Map<K, CacheEntry<V>>();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize: number = 50, ttlMinutes: number = 30) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMinutes * 60 * 1000;
  }

  get(key: K): V | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) this.cache.delete(key);
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(key, { value, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

export const searchCache = new LRUCache<string, string>(50, 30);
export const weatherCache = new LRUCache<string, string>(100, 15);
export const amapCache = new LRUCache<string, string>(50, 60);
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/cache.ts
git commit -m "feat: add LRU cache module"
```

---

## Task 3: lib 基础设施 — fetch-utils.ts

**Files:**
- Create: `src/lib/fetch-utils.ts`
- Reference: `D:\知识学习\LangChain\src\utils\fetch-utils.ts`

- [ ] **Step 1: 创建 HTTP 工具函数**

```typescript
// src/lib/fetch-utils.ts

const DEFAULT_TIMEOUT = 10000;
const MAX_RETRIES = 2;

export async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = MAX_RETRIES,
  delay: number = 1000,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
}

export async function fetchWithTimeout(
  url: string,
  timeout: number = DEFAULT_TIMEOUT,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/fetch-utils.ts
git commit -m "feat: add fetch utilities with retry and timeout"
```

---

## Task 4: lib 基础设施 — llm.ts

**Files:**
- Create: `src/lib/llm.ts`

- [ ] **Step 1: 创建 LLM 配置**

```typescript
// src/lib/llm.ts
import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";

export const model = new ChatOpenAI({
  model: "gpt-4o-mini",
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  },
  temperature: 0.7,
});
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/llm.ts
git commit -m "feat: add OpenAI LLM configuration"
```

---

## Task 5: schemas — collected-info.ts

**Files:**
- Create: `src/schemas/collected-info.ts`

- [ ] **Step 1: 创建 collectedInfo schema**

```typescript
// src/schemas/collected-info.ts
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
```

- [ ] **Step 2: Commit**

```bash
git add src/schemas/collected-info.ts
git commit -m "feat: add collectedInfo Zod schema"
```

---

## Task 6: schemas — travel-plan.ts

**Files:**
- Create: `src/schemas/travel-plan.ts`
- Reference: `D:\知识学习\LangChain\src\tools\plan-schema.ts`

- [ ] **Step 1: 创建旅行计划 schema**

```typescript
// src/schemas/travel-plan.ts
import { z } from "zod";

export const dailyActivitySchema = z.object({
  time: z.string().optional().describe("活动时间，如 09:00"),
  activity: z.string().describe("活动名称"),
  location: z.string().describe("活动地点"),
  duration: z.string().optional().describe("预计耗时，如 2小时"),
  notes: z.string().optional().describe("备注，如需要预约"),
});

export const dailyMealSchema = z.object({
  type: z.enum(["breakfast", "lunch", "dinner", "snack"]).describe("餐食类型"),
  recommendation: z.string().describe("推荐菜品或餐厅"),
  estimatedCost: z.string().optional().describe("预估人均花费"),
});

export const dailyPlanSchema = z.object({
  day: z.number().describe("第几天"),
  title: z.string().describe("当天主题"),
  activities: z.array(dailyActivitySchema).describe("当天活动列表"),
  meals: z.array(dailyMealSchema).describe("当天美食推荐"),
});

export const travelPlanSchema = z.object({
  destination: z.string().describe("目的地"),
  overview: z.string().describe("目的地简要介绍"),
  bestSeason: z.string().optional().describe("最佳旅游季节"),
  accommodation: z.object({
    area: z.string().describe("推荐住宿区域"),
    recommendation: z.string().describe("住宿建议"),
    estimatedCost: z.string().describe("住宿预算"),
  }),
  transportation: z.object({
    howToGetThere: z.string().describe("如何到达目的地"),
    localTransport: z.string().describe("当地交通建议"),
  }),
  dailyPlans: z.array(dailyPlanSchema).describe("每日行程"),
  foodRecommendations: z.array(z.string()).describe("当地特色美食推荐"),
  budget: z.object({
    total: z.string().describe("总预算估算"),
    breakdown: z
      .array(z.object({ category: z.string(), cost: z.string() }))
      .describe("各项费用明细"),
  }),
  warnings: z.array(z.string()).describe("注意事项"),
});

export type TravelPlan = z.infer<typeof travelPlanSchema>;
```

- [ ] **Step 2: Commit**

```bash
git add src/schemas/travel-plan.ts
git commit -m "feat: add travelPlan Zod schema"
```

---

## Task 7: agent/state.ts — 状态定义

**Files:**
- Create: `src/agent/state.ts`

- [ ] **Step 1: 定义 AgentState**

```typescript
// src/agent/state.ts
import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import type { CollectedInfo } from "../schemas/collected-info";

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  collectedInfo: Annotation<CollectedInfo>({
    reducer: (_, newVal) => newVal,
    default: () => ({ preferences: [], constraints: [] }),
  }),
  phase: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "info_gathering",
  }),
});

export type AgentStateType = typeof AgentState.State;
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/state.ts
git commit -m "feat: define AgentState with messages, collectedInfo, phase"
```

---

## Task 8: agent/tools — 信息收集工具

**Files:**
- Create: `src/agent/tools/confirm-info.ts`
- Create: `src/agent/tools/update-info.ts`

- [ ] **Step 1: 创建 confirm_info 工具**

```typescript
// src/agent/tools/confirm-info.ts
import { z } from "zod";
import { tool } from "@langchain/core/tools";

export const confirmInfo = tool(
  async () => {
    return "信息已确认，可以开始生成旅行计划了。";
  },
  {
    name: "confirm_info",
    description:
      "当收集到足够的旅行信息后调用此工具，表示信息收集完毕，可以进入计划生成阶段。只在所有关键信息都收集齐全后才调用。",
    schema: z.object({}),
  },
);
```

- [ ] **Step 2: 创建 update_collected_info 工具**

```typescript
// src/agent/tools/update-info.ts
import { tool } from "@langchain/core/tools";
import { collectedInfoSchema } from "../../schemas/collected-info";

export const updateCollectedInfo = tool(
  async (info) => {
    return JSON.stringify(info);
  },
  {
    name: "update_collected_info",
    description:
      "从用户的回复中提取旅行相关信息并更新。每次用户回答了问题都应该调用此工具来记录提取到的信息。只传有新信息的字段。",
    schema: collectedInfoSchema.partial(),
  },
);
```

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/confirm-info.ts src/agent/tools/update-info.ts
git commit -m "feat: add info gathering tools (confirm_info, update_collected_info)"
```

---

## Task 9: agent/tools — 高德地图工具

**Files:**
- Create: `src/agent/tools/amap.ts`
- Reference: `D:\知识学习\LangChain\src\tools\amap.ts`

- [ ] **Step 1: 创建高德地图工具**

```typescript
// src/agent/tools/amap.ts
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { amapCache } from "../../lib/cache";
import { withRetry, fetchWithTimeout } from "../../lib/fetch-utils";

const apiKey = process.env.AMAP_API_KEY;

export const searchAttractions = tool(
  async ({ keyword, city }: { keyword: string; city: string }) => {
    if (!apiKey) return "错误：未设置 AMAP_API_KEY 环境变量。";

    const cacheKey = `attractions:${city.trim()}:${keyword.trim()}`;
    const cached = amapCache.get(cacheKey);
    if (cached !== null) return `(缓存命中)\n${cached}`;

    const params = new URLSearchParams({
      keywords: keyword.trim(),
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
        const result = `未找到 "${city}" 中与 "${keyword}" 相关的景点。`;
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
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/tools/amap.ts
git commit -m "feat: add amap tools (search_attractions, search_nearby)"
```

---

## Task 10: agent/tools — 天气工具

**Files:**
- Create: `src/agent/tools/weather.ts`
- Reference: `D:\知识学习\LangChain\src\tools\weather.ts`

- [ ] **Step 1: 创建天气查询工具**

```typescript
// src/agent/tools/weather.ts
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { weatherCache } from "../../lib/cache";
import { withRetry, fetchWithTimeout } from "../../lib/fetch-utils";

export const getWeather = tool(
  async ({ location, days = 1 }: { location: string; days?: number }) => {
    const apiKey = process.env.QWEATHER_API_KEY;
    if (!apiKey) return "错误：未设置 QWEATHER_API_KEY 环境变量。";

    const cleanLocation = location.trim();
    const cacheKey = `${cleanLocation}:${days}`;
    const cached = weatherCache.get(cacheKey);
    if (cached !== null) return `(缓存命中)\n${cached}`;

    try {
      // Step 1: City lookup
      const searchUrl = new URL("https://geoapi.qweather.com/v2/city/lookup");
      searchUrl.searchParams.set("location", cleanLocation);
      searchUrl.searchParams.set("key", apiKey);
      searchUrl.searchParams.set("lang", "zh");

      const searchData = await withRetry(async () => {
        const res = await fetchWithTimeout(searchUrl.toString());
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as {
          code: string;
          location?: Array<{
            id: string;
            name: string;
            adm1: string;
            country: string;
          }>;
        };
      });

      if (searchData.code !== "200" || !searchData.location?.length) {
        return `未找到位置 "${location}"。`;
      }

      const loc = searchData.location[0];
      const locationId = loc.id;
      let result = `📍 ${loc.name}, ${loc.adm1}, ${loc.country}\n\n`;

      // Step 2: Current weather
      const nowUrl = new URL("https://devapi.qweather.com/v7/weather/now");
      nowUrl.searchParams.set("location", locationId);
      nowUrl.searchParams.set("key", apiKey);

      const nowData = await withRetry(async () => {
        const res = await fetchWithTimeout(nowUrl.toString());
        return (await res.json()) as {
          code: string;
          now?: {
            text: string;
            temp: string;
            feelsLike: string;
            windDir: string;
            windScale: string;
            humidity: string;
          };
        };
      });

      if (nowData.code === "200" && nowData.now) {
        const now = nowData.now;
        result += `🌤️ 当前天气：${now.text}，${now.temp}°C（体感${now.feelsLike}°C），${now.windDir}${now.windScale}级，湿度${now.humidity}%\n\n`;
      }

      // Step 3: Forecast
      if (days > 0) {
        const dailyUrl = new URL("https://devapi.qweather.com/v7/weather/7d");
        dailyUrl.searchParams.set("location", locationId);
        dailyUrl.searchParams.set("key", apiKey);

        const dailyData = await withRetry(async () => {
          const res = await fetchWithTimeout(dailyUrl.toString());
          return (await res.json()) as {
            code: string;
            daily?: Array<{
              fxDate: string;
              textDay: string;
              textNight: string;
              tempMin: string;
              tempMax: string;
            }>;
          };
        });

        if (dailyData.code === "200" && dailyData.daily) {
          const forecastDays = dailyData.daily.slice(0, Math.min(days, 7));
          result += `📅 未来${forecastDays.length}天预报：\n`;
          for (const day of forecastDays) {
            result += `  ${day.fxDate}: ${day.textDay}/${day.textNight}，${day.tempMin}°C~${day.tempMax}°C\n`;
          }
        }
      }

      const finalResult = result.trim();
      weatherCache.set(cacheKey, finalResult);
      return finalResult;
    } catch (error) {
      return `获取天气失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "get_weather",
    description: "获取指定地区当前天气和未来多天预报。",
    schema: z.object({
      location: z.string().describe("城市名，如 北京、深圳"),
      days: z.number().min(1).max(7).optional().default(1).describe("预报天数"),
    }),
  },
);
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/tools/weather.ts
git commit -m "feat: add weather tool (get_weather)"
```

---

## Task 11: agent/tools — 搜索工具 + submit_plan

**Files:**
- Create: `src/agent/tools/search.ts`
- Create: `src/agent/tools/submit-plan.ts`
- Reference: `D:\知识学习\LangChain\src\tools\search.ts`, `D:\知识学习\LangChain\src\tools\submit-plan.ts`

- [ ] **Step 1: 创建 Web 搜索工具**

```typescript
// src/agent/tools/search.ts
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
```

- [ ] **Step 2: 创建 submit_plan 工具**

```typescript
// src/agent/tools/submit-plan.ts
import { tool } from "@langchain/core/tools";
import { travelPlanSchema, type TravelPlan } from "../../schemas/travel-plan";

function formatActivities(
  activities: TravelPlan["dailyPlans"][number]["activities"],
): string {
  if (!activities.length) return "";
  let table =
    "| 时间 | 活动 | 地点 | 耗时 | 备注 |\n|------|------|------|------|------|\n";
  for (const a of activities) {
    table += `| ${a.time || "-"} | ${a.activity} | ${a.location} | ${a.duration || "-"} | ${a.notes || "-"} |\n`;
  }
  return table;
}

function formatMeals(meals: TravelPlan["dailyPlans"][number]["meals"]): string {
  const labels: Record<string, string> = {
    breakfast: "早餐",
    lunch: "午餐",
    dinner: "晚餐",
    snack: "小吃",
  };
  return meals
    .map(
      (m) =>
        `  - ${labels[m.type] || m.type}: ${m.recommendation}${m.estimatedCost ? ` (约${m.estimatedCost})` : ""}`,
    )
    .join("\n");
}

function renderMarkdown(plan: TravelPlan): string {
  let md = `# ${plan.destination} 旅游攻略\n\n`;
  md += `## 目的地概览\n\n${plan.overview}\n\n`;
  if (plan.bestSeason) md += `**最佳旅游季节**：${plan.bestSeason}\n\n`;

  md += `## 住宿推荐\n\n`;
  md += `- **推荐区域**：${plan.accommodation.area}\n`;
  md += `- **住宿建议**：${plan.accommodation.recommendation}\n`;
  md += `- **预算**：${plan.accommodation.estimatedCost}\n\n`;

  md += `## 交通建议\n\n`;
  md += `- **到达方式**：${plan.transportation.howToGetThere}\n`;
  md += `- **当地交通**：${plan.transportation.localTransport}\n\n`;

  md += `## 每日行程\n\n`;
  for (const day of plan.dailyPlans) {
    md += `### 第${day.day}天：${day.title}\n\n`;
    md += formatActivities(day.activities);
    md += `\n**美食推荐**：\n${formatMeals(day.meals)}\n\n`;
  }

  md += `## 特色美食\n\n`;
  for (const food of plan.foodRecommendations) md += `- ${food}\n`;

  md += `\n## 预算估算\n\n**总计**：${plan.budget.total}\n\n`;
  md += `| 项目 | 费用 |\n|------|------|\n`;
  for (const item of plan.budget.breakdown)
    md += `| ${item.category} | ${item.cost} |\n`;

  md += `\n## ⚠️ 注意事项\n\n`;
  for (const w of plan.warnings) md += `- ${w}\n`;

  return md;
}

export const submitPlan = tool(
  async (plan) => {
    return renderMarkdown(plan as TravelPlan);
  },
  {
    name: "submit_plan",
    description:
      "提交最终的旅游计划。只有用户明确确认后才调用，调用一次后不再修改。",
    schema: travelPlanSchema,
  },
);
```

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/search.ts src/agent/tools/submit-plan.ts
git commit -m "feat: add search and submit_plan tools"
```

---

## Task 12: agent/tools/index.ts

**Files:**
- Create: `src/agent/tools/index.ts`

- [ ] **Step 1: 统一导出**

```typescript
// src/agent/tools/index.ts
export { confirmInfo } from "./confirm-info";
export { updateCollectedInfo } from "./update-info";
export { searchAttractions, searchNearby } from "./amap";
export { getWeather } from "./weather";
export { webSearch } from "./search";
export { submitPlan } from "./submit-plan";
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/tools/index.ts
git commit -m "feat: add tools barrel export"
```

---

## Task 13: agent/prompts — 提示词

**Files:**
- Create: `src/agent/prompts/info.ts`
- Create: `src/agent/prompts/plan.ts`

- [ ] **Step 1: 创建信息收集 prompt**

```typescript
// src/agent/prompts/info.ts

export const infoSystemPrompt = `你是一个热情友好的旅行顾问助手。你的任务是通过自然对话收集用户的旅行需求信息。

# 你需要收集的信息
1. 目的地（必须）
2. 旅行天数（必须）
3. 同行人数（必须）
4. 出行日期或时间段
5. 预算范围
6. 旅行偏好（自然风光/人文历史/美食/购物/休闲等）
7. 特殊约束（老人/小孩/饮食禁忌/身体限制等）

# 对话规则
- 每轮只问 1-2 个问题，不要一次性问完所有信息
- 用自然、友好的语气提问，像朋友聊天一样
- 从用户的回复中提取信息，调用 update_collected_info 工具记录
- 当你收集到目的地、天数、人数这三个核心信息后，再确认偏好和约束
- 信息足够后（至少有目的地、天数、人数），调用 confirm_info 工具
- 不要自己生成旅行计划，那是下一步的工作
- 回复要简洁，可以用 emoji 增加亲和力

# 示例对话
用户：我想去云南玩
你：云南好呀！🏔️ 你打算去几天呢？
（同时调用 update_collected_info({ destination: "云南" })）

用户：3天吧，和女朋友一起
你：收到！3天的云南之旅，两个人同行～ 预算大概多少？有什么特别想去的地方吗？
（同时调用 update_collected_info({ days: 3, people: 2 })）
`;
```

- [ ] **Step 2: 创建规划 prompt**

```typescript
// src/agent/prompts/plan.ts
import type { CollectedInfo } from "../../schemas/collected-info";

export function buildPlanSystemPrompt(info: CollectedInfo): string {
  const infoSummary = [
    info.destination && `目的地：${info.destination}`,
    info.days && `天数：${info.days}天`,
    info.people && `人数：${info.people}人`,
    info.dateRange && `日期：${info.dateRange}`,
    info.budget && `预算：${info.budget}`,
    info.preferences.length && `偏好：${info.preferences.join("、")}`,
    info.constraints.length && `约束：${info.constraints.join("、")}`,
  ]
    .filter(Boolean)
    .join("\n");

  return `你是一个专业的旅行规划师。根据以下用户需求制定详细的旅行计划。

# 用户需求
${infoSummary}

# 工作流程
1. 先用 get_weather 查询目的地天气
2. 用 search_attractions 搜索景点
3. 用 search_nearby 搜索周边酒店和餐厅
4. 综合所有信息生成旅行计划
5. 调用 submit_plan 提交最终计划

# 规划原则
- 将同一区域的景点安排在同一天，减少交通时间
- 每天留出 1-2 小时自由活动时间
- 考虑天气情况安排室内外活动
- 结合用户偏好推荐景点和美食
- 预算要合理分配（门票+住宿+餐饮+交通）
- 如有老人/小孩，避免安排需要大量步行的行程

# 输出要求
必须包含：目的地概览、住宿推荐、交通建议、每日行程（含活动和餐饮）、特色美食、预算估算、注意事项

# 重要
- submit_plan 只调用一次，用户确认后才调用
- 如果用户要求修改，根据反馈调整计划后重新提交
- LLM 已有的知识可以直接使用，不确定的信息要用工具查询
`;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/agent/prompts/info.ts src/agent/prompts/plan.ts
git commit -m "feat: add system prompts for info gathering and planning phases"
```

---

## Task 14: agent/nodes — router.ts

**Files:**
- Create: `src/agent/nodes/router.ts`

- [ ] **Step 1: 创建路由节点**

```typescript
// src/agent/nodes/router.ts
import type { AgentStateType } from "../state";

export function router(state: AgentStateType): string {
  return state.phase;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/nodes/router.ts
git commit -m "feat: add router node"
```

---

## Task 15: agent/nodes — info-agent.ts

**Files:**
- Create: `src/agent/nodes/info-agent.ts`

- [ ] **Step 1: 创建信息收集 Agent 节点**

```typescript
// src/agent/nodes/info-agent.ts
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { model } from "../../lib/llm";
import type { AgentStateType } from "../state";
import { infoSystemPrompt } from "../prompts/info";
import { confirmInfo, updateCollectedInfo } from "../tools";

const infoTools = [updateCollectedInfo, confirmInfo];
const modelWithInfoTools = model.bindTools(infoTools);

export async function callInfoAgent(
  state: AgentStateType,
): Promise<Partial<AgentStateType>> {
  const messages = [{ role: "system", content: infoSystemPrompt }, ...state.messages];
  const response = await modelWithInfoTools.invoke(messages);
  return { messages: [response] };
}

// 处理 info_tools 返回的 ToolMessage，更新 collectedInfo
export function processInfoToolsResult(
  state: AgentStateType,
): Partial<AgentStateType> {
  // 找到最近的 AI 消息，检查是否有 confirm_info 调用
  let lastAiIdx = -1;
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (AIMessage.isInstance(state.messages[i])) {
      lastAiIdx = i;
      break;
    }
  }

  if (lastAiIdx === -1) return {};

  const aiMsg = state.messages[lastAiIdx] as AIMessage;
  const hasConfirm = aiMsg.tool_calls?.some(
    (tc) => tc.name === "confirm_info",
  );

  // 检查最后的 ToolMessage 中是否有 update_collected_info 的结果
  const lastToolMsg = state.messages.at(-1);
  if (lastToolMsg && ToolMessage.isInstance(lastToolMsg)) {
    // 找到对应的 tool_call args（从 AI 消息中）
    const updateCall = aiMsg.tool_calls?.find(
      (tc) => tc.name === "update_collected_info" && tc.id === lastToolMsg.tool_call_id,
    );

    if (updateCall) {
      const newInfo = updateCall.args as Record<string, unknown>;
      const updates: Partial<AgentStateType> = {
        collectedInfo: {
          ...state.collectedInfo,
          ...newInfo,
          preferences: newInfo.preferences
            ? (newInfo.preferences as string[])
            : state.collectedInfo.preferences,
          constraints: newInfo.constraints
            ? (newInfo.constraints as string[])
            : state.collectedInfo.constraints,
        },
      };

      if (hasConfirm) {
        updates.phase = "planning";
      }

      return updates;
    }
  }

  if (hasConfirm) {
    return { phase: "planning" };
  }

  return {};
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/nodes/info-agent.ts
git commit -m "feat: add info-agent node with collectedInfo update logic"
```

---

## Task 16: agent/nodes — plan-agent.ts

**Files:**
- Create: `src/agent/nodes/plan-agent.ts`

- [ ] **Step 1: 创建规划 Agent 节点**

```typescript
// src/agent/nodes/plan-agent.ts
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { model } from "../../lib/llm";
import type { AgentStateType } from "../state";
import { buildPlanSystemPrompt } from "../prompts/plan";
import {
  searchAttractions,
  searchNearby,
  getWeather,
  webSearch,
  submitPlan,
} from "../tools";

const planTools = [searchAttractions, searchNearby, getWeather, webSearch, submitPlan];
const modelWithPlanTools = model.bindTools(planTools);

export async function callPlanAgent(
  state: AgentStateType,
): Promise<Partial<AgentStateType>> {
  const systemPrompt = buildPlanSystemPrompt(state.collectedInfo);
  const messages = [{ role: "system", content: systemPrompt }, ...state.messages];

  let response = await modelWithPlanTools.invoke(messages);

  // 死循环保护：最多 8 轮工具调用
  let lastHumanIdx = -1;
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i]?.getType() === "human") {
      lastHumanIdx = i;
      break;
    }
  }
  const toolCallRounds = state.messages
    .slice(lastHumanIdx + 1)
    .filter((m) => AIMessage.isInstance(m) && (m.tool_calls?.length ?? 0) > 0)
    .length;

  if (
    toolCallRounds > 8 &&
    AIMessage.isInstance(response) &&
    (response.tool_calls?.length ?? 0) > 0
  ) {
    response = await modelWithPlanTools.invoke([
      ...messages,
      response,
      {
        role: "user",
        content: "你已经调用了足够多的工具。请立刻基于已有信息输出最终回复，不要再调用任何工具。",
      },
    ]);
  }

  return { messages: [response] };
}

export function afterPlanAgent(
  state: AgentStateType,
): Partial<AgentStateType> {
  const lastMessage = state.messages.at(-1);
  if (!lastMessage || !AIMessage.isInstance(lastMessage)) return {};

  const hasSubmitPlan = lastMessage.tool_calls?.some(
    (tc) => tc.name === "submit_plan",
  );

  if (hasSubmitPlan) {
    // 计划已提交，phase 保持 planning（interrupt 后由用户输入决定下一步）
    return {};
  }

  return {};
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/nodes/plan-agent.ts
git commit -m "feat: add plan-agent node with tool loop and dead-loop protection"
```

---

## Task 17: agent/nodes — save.ts

**Files:**
- Create: `src/agent/nodes/save.ts`

- [ ] **Step 1: 创建保存节点**

```typescript
// src/agent/nodes/save.ts
import type { AgentStateType } from "../state";

export function saveNode(state: AgentStateType): Partial<AgentStateType> {
  // 保存逻辑在 API route 中处理（检测 submit_plan 工具调用）
  // 此节点标记流程结束
  return { phase: "done" };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/nodes/save.ts
git commit -m "feat: add save node"
```

---

## Task 18: agent/graph.ts — 状态机构建

**Files:**
- Create: `src/agent/graph.ts`

- [ ] **Step 1: 构建 LangGraph 状态机**

```typescript
// src/agent/graph.ts
import "dotenv/config";
import {
  END,
  START,
  StateGraph,
  interrupt,
  MemorySaver,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { AgentState, type AgentStateType } from "./state";
import { router } from "./nodes/router";
import { callInfoAgent, processInfoToolsResult } from "./nodes/info-agent";
import { callPlanAgent, afterPlanAgent } from "./nodes/plan-agent";
import { saveNode } from "./nodes/save";
import {
  updateCollectedInfo,
  confirmInfo,
  searchAttractions,
  searchNearby,
  getWeather,
  webSearch,
  submitPlan,
} from "./tools";

// Info tools (for infoAgent's ToolNode)
const infoToolsList = [updateCollectedInfo, confirmInfo];
const infoToolNode = new ToolNode(infoToolsList);

// Plan tools (for planAgent's ToolNode)
const planToolsList = [
  searchAttractions,
  searchNearby,
  getWeather,
  webSearch,
  submitPlan,
];
const planToolNode = new ToolNode(planToolsList);

// ── processInfoToolsResult wrapper with interrupt ──
// 在 info_tools 执行后运行，更新 collectedInfo 并检查是否需要中断
function processInfoWithInterrupt(
  state: AgentStateType,
): Partial<AgentStateType> {
  const updates = processInfoToolsResult(state);

  // 如果 phase 变为 planning，说明 confirm_info 被调用
  if (updates.phase === "planning") {
    const info = { ...state.collectedInfo, ...(updates.collectedInfo || {}) };
    const summary = [
      info.destination && `目的地：${info.destination}`,
      info.days && `天数：${info.days}天`,
      info.people && `人数：${info.people}人`,
      info.dateRange && `日期：${info.dateRange}`,
      info.budget && `预算：${info.budget}`,
      info.preferences.length && `偏好：${info.preferences.join("、")}`,
      info.constraints.length && `约束：${info.constraints.join("、")}`,
    ]
      .filter(Boolean)
      .join("\n");

    interrupt(
      `已收集到以下信息：\n\n${summary}\n\n确认无误请回复"确认"，或告诉我需要补充的信息。`,
    );
  }

  return updates;
}

// ── afterPlanAgent wrapper with interrupt ──
function afterPlanAgentWithInterrupt(
  state: AgentStateType,
): Partial<AgentStateType> {
  const lastMessage = state.messages.at(-1);
  if (!lastMessage || !AIMessage.isInstance(lastMessage)) return {};

  const hasSubmitPlan = lastMessage.tool_calls?.some(
    (tc) => tc.name === "submit_plan",
  );

  if (hasSubmitPlan) {
    interrupt(
      "旅行计划已生成！请查看上方内容。你可以：\n- 说"没问题"保存计划\n- 说修改意见，如"第二天换成海边景点"",
    );
  }

  return {};
}

// ── 条件路由 ──
function routeAfterInfo(state: AgentStateType): "info_tools" | "after_info" {
  const lastMessage = state.messages.at(-1);
  if (!lastMessage || !AIMessage.isInstance(lastMessage)) return "after_info";
  if (lastMessage.tool_calls?.length) return "info_tools";
  return "after_info";
}

function routeAfterPlan(state: AgentStateType): "plan_tools" | "after_plan" {
  const lastMessage = state.messages.at(-1);
  if (!lastMessage || !AIMessage.isInstance(lastMessage)) return "after_plan";
  if (lastMessage.tool_calls?.length) return "plan_tools";
  return "after_plan";
}

function routeAfterPlanTools(
  state: AgentStateType,
): "plan_tools" | "after_plan" {
  const lastMessage = state.messages.at(-1);
  if (!lastMessage || !AIMessage.isInstance(lastMessage)) return "after_plan";
  if (lastMessage.tool_calls?.length) return "plan_tools";
  return "after_plan";
}

// ── 图构建 ──
const workflow = new StateGraph(AgentState)
  // 节点
  .addNode("router", router)
  .addNode("info_agent", callInfoAgent)
  .addNode("info_tools", infoToolNode)
  .addNode("process_info", processInfoWithInterrupt)
  .addNode("plan_agent", callPlanAgent)
  .addNode("plan_tools", planToolNode)
  .addNode("after_plan", afterPlanAgentWithInterrupt)
  .addNode("save", saveNode)

  // 固定边
  .addEdge(START, "router")
  .addEdge("info_tools", "process_info")
  .addEdge("process_info", "router")
  .addEdge("plan_tools", "plan_agent")
  .addEdge("save", END)

  // 条件边：router 根据 phase 路由
  .addConditionalEdges("router", (state: AgentStateType) => {
    if (state.phase === "info_gathering") return "info_agent";
    if (state.phase === "planning" || state.phase === "refinement")
      return "plan_agent";
    return END;
  })

  // 条件边：info_agent 之后 → 有工具调用就执行工具，否则回到 router
  .addConditionalEdges("info_agent", routeAfterInfo, {
    info_tools: "info_tools",
    after_info: "router",
  })

  // 条件边：plan_agent 之后
  .addConditionalEdges("plan_agent", routeAfterPlan, {
    plan_tools: "plan_tools",
    after_plan: "after_plan",
  })

  // after_plan → save 或 router
  .addConditionalEdges("after_plan", (state: AgentStateType) => {
    if (state.phase === "done") return "save";
    return "router";
  });

// ── 编译 ──
const checkpointer = new MemorySaver();

export const travelAgent = workflow.compile({ checkpointer });
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/graph.ts
git commit -m "feat: build LangGraph state machine with 4-phase flow"
```

---

## Task 19: app/api/chat/route.ts — SSE 流式 API

**Files:**
- Create: `src/app/api/chat/route.ts`

- [ ] **Step 1: 创建 SSE 流式 API Route**

```typescript
// src/app/api/chat/route.ts
import { NextRequest } from "next/server";
import { HumanMessage } from "@langchain/core/messages";
import { travelAgent } from "@/agent/graph";

export async function POST(req: NextRequest) {
  const { message, threadId } = await req.json();

  const config = {
    configurable: { thread_id: threadId },
    streamMode: "updates" as const,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const eventStream = await travelAgent.stream(
          { messages: [new HumanMessage(message)] },
          config,
        );

        for await (const chunk of eventStream) {
          // info_agent 节点输出
          if (chunk.info_agent?.messages?.length) {
            const lastMsg =
              chunk.info_agent.messages[chunk.info_agent.messages.length - 1];
            if (
              lastMsg?.getType() === "ai" &&
              typeof lastMsg.content === "string" &&
              lastMsg.content
            ) {
              send({ type: "token", content: lastMsg.content });
            }
          }

          // after_info 节点 — 发送 collectedInfo 更新
          if (chunk.after_info) {
            if (chunk.after_info.collectedInfo) {
              send({
                type: "info",
                data: chunk.after_info.collectedInfo,
              });
            }
            if (chunk.after_info.phase) {
              send({ type: "phase", data: chunk.after_info.phase });
            }
          }

          // plan_agent 节点输出
          if (chunk.plan_agent?.messages?.length) {
            const lastMsg =
              chunk.plan_agent.messages[
                chunk.plan_agent.messages.length - 1
              ];
            if (
              lastMsg?.getType() === "ai" &&
              typeof lastMsg.content === "string" &&
              lastMsg.content
            ) {
              send({ type: "token", content: lastMsg.content });
            }
          }

          // plan_tools — 捕获 submit_plan 返回的 Markdown
          if (chunk.plan_tools?.messages?.length) {
            for (const msg of chunk.plan_tools.messages) {
              if (
                msg.name === "submit_plan" &&
                typeof msg.content === "string"
              ) {
                send({ type: "plan", markdown: msg.content });
              }
            }
          }
        }

        send({ type: "done" });
      } catch (error: unknown) {
        // 处理 GraphInterrupt
        if (
          error instanceof Error &&
          error.name === "GraphInterrupt"
        ) {
          send({ type: "interrupt", message: "等待用户确认" });
        } else {
          send({
            type: "error",
            message: error instanceof Error ? error.message : "未知错误",
          });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat: add SSE streaming chat API route"
```

---

## Task 20: 前端 — ChatPanel.tsx

**Files:**
- Create: `src/components/ChatPanel.tsx`
- Create: `src/components/MessageBubble.tsx`

- [ ] **Step 1: 创建 MessageBubble 组件**

```typescript
// src/components/MessageBubble.tsx
"use client";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
}

export function MessageBubble({ role, content }: MessageBubbleProps) {
  return (
    <div
      className={`flex ${role === "user" ? "justify-end" : "justify-start"} mb-3`}
    >
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          role === "user"
            ? "bg-blue-600 text-white"
            : "bg-gray-100 text-gray-900"
        }`}
      >
        <div className="whitespace-pre-wrap">{content}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 ChatPanel 组件**

```typescript
// src/components/ChatPanel.tsx
"use client";

import { useState, useRef, useCallback } from "react";
import { MessageBubble } from "./MessageBubble";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatPanelProps {
  onInfoUpdate: (info: Record<string, unknown>) => void;
  onPhaseUpdate: (phase: string) => void;
  onPlanUpdate: (markdown: string) => void;
}

export function ChatPanel({
  onInfoUpdate,
  onPhaseUpdate,
  onPlanUpdate,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [threadId] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("travel-thread-id");
      if (stored) return stored;
      const id = crypto.randomUUID();
      localStorage.setItem("travel-thread-id", id);
      return id;
    }
    return crypto.randomUUID();
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsStreaming(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage, threadId }),
      });

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let assistantContent = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));

            switch (data.type) {
              case "token":
                assistantContent += data.content;
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    role: "assistant",
                    content: assistantContent,
                  };
                  return updated;
                });
                break;
              case "info":
                onInfoUpdate(data.data);
                break;
              case "phase":
                onPhaseUpdate(data.data);
                break;
              case "plan":
                onPlanUpdate(data.markdown);
                break;
              case "interrupt":
                // interrupt 状态，等待用户输入
                break;
              case "error":
                assistantContent += `\n\n错误：${data.message}`;
                break;
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `连接错误：${error instanceof Error ? error.message : "未知错误"}`,
        },
      ]);
    } finally {
      setIsStreaming(false);
      scrollToBottom();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-20">
            <p className="text-lg">告诉我你的旅行想法</p>
            <p className="text-sm mt-2">
              比如 "我想去云南玩" 或 "帮我规划厦门3天游"
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} role={msg.role} content={msg.content} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-gray-200 p-4 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入你的旅行想法..."
          className="flex-1 rounded-full border border-gray-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={isStreaming}
        />
        <button
          type="submit"
          disabled={isStreaming || !input.trim()}
          className="rounded-full bg-blue-600 px-6 py-2 text-sm text-white font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors"
        >
          {isStreaming ? "..." : "发送"}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ChatPanel.tsx src/components/MessageBubble.tsx
git commit -m "feat: add ChatPanel and MessageBubble components"
```

---

## Task 21: 前端 — InfoSidebar.tsx + PlanCard.tsx

**Files:**
- Create: `src/components/InfoSidebar.tsx`
- Create: `src/components/PlanCard.tsx`

- [ ] **Step 1: 创建 InfoSidebar 组件**

```typescript
// src/components/InfoSidebar.tsx
"use client";

interface InfoSidebarProps {
  collectedInfo: Record<string, unknown>;
  phase: string;
}

const fields = [
  { key: "destination", label: "目的地" },
  { key: "days", label: "天数", suffix: "天" },
  { key: "people", label: "人数", suffix: "人" },
  { key: "dateRange", label: "日期" },
  { key: "budget", label: "预算" },
];

export function InfoSidebar({ collectedInfo, phase }: InfoSidebarProps) {
  const phaseLabels: Record<string, { text: string; color: string }> = {
    info_gathering: { text: "信息收集中...", color: "text-blue-500" },
    planning: { text: "计划生成中...", color: "text-yellow-500" },
    refinement: { text: "迭代优化中...", color: "text-purple-500" },
    done: { text: "已完成", color: "text-green-500" },
  };

  const phaseInfo = phaseLabels[phase] || phaseLabels.info_gathering;

  return (
    <div className="h-full bg-gray-50 p-4 overflow-y-auto">
      <h3 className="font-semibold text-gray-800 mb-4">已收集信息</h3>

      <div className="space-y-2 text-sm">
        {fields.map(({ key, label, suffix }) => {
          const value = collectedInfo[key];
          const hasValue = value !== undefined && value !== null && value !== "";
          return (
            <div key={key} className="flex items-center gap-2">
              <span className={hasValue ? "text-green-500" : "text-yellow-500"}>
                {hasValue ? "✓" : "○"}
              </span>
              <span className="text-gray-600">{label}：</span>
              <span className={hasValue ? "text-gray-900" : "text-gray-400"}>
                {hasValue
                  ? `${value}${suffix || ""}`
                  : "待收集"}
              </span>
            </div>
          );
        })}

        {/* 偏好 */}
        <div className="flex items-start gap-2">
          <span
            className={
              (collectedInfo.preferences as string[])?.length
                ? "text-green-500"
                : "text-yellow-500"
            }
          >
            {(collectedInfo.preferences as string[])?.length ? "✓" : "○"}
          </span>
          <span className="text-gray-600">偏好：</span>
          <span className="text-gray-400">
            {(collectedInfo.preferences as string[])?.length
              ? (collectedInfo.preferences as string[]).join("、")
              : "待收集"}
          </span>
        </div>

        {/* 约束 */}
        <div className="flex items-start gap-2">
          <span
            className={
              (collectedInfo.constraints as string[])?.length
                ? "text-green-500"
                : "text-yellow-500"
            }
          >
            {(collectedInfo.constraints as string[])?.length ? "✓" : "○"}
          </span>
          <span className="text-gray-600">约束：</span>
          <span className="text-gray-400">
            {(collectedInfo.constraints as string[])?.length
              ? (collectedInfo.constraints as string[]).join("、")
              : "待收集"}
          </span>
        </div>
      </div>

      <div className="mt-6 pt-4 border-t border-gray-200">
        <h3 className="font-semibold text-gray-800 mb-2">当前阶段</h3>
        <div className={`text-sm font-medium ${phaseInfo.color}`}>
          {phaseInfo.text}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 PlanCard 组件**

```typescript
// src/components/PlanCard.tsx
"use client";

interface PlanCardProps {
  markdown: string;
  onSave?: () => void;
  onRetry?: () => void;
}

export function PlanCard({ markdown, onSave, onRetry }: PlanCardProps) {
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
      <div className="bg-gradient-to-r from-blue-500 to-purple-500 px-4 py-3">
        <h3 className="text-white font-semibold">旅行计划</h3>
      </div>

      <div className="p-4 max-h-96 overflow-y-auto">
        <div className="prose prose-sm max-w-none whitespace-pre-wrap text-gray-700">
          {markdown}
        </div>
      </div>

      <div className="border-t border-gray-100 p-3 flex gap-2 justify-end">
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            重新生成
          </button>
        )}
        {onSave && (
          <button
            onClick={onSave}
            className="px-4 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
          >
            满意，保存
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/InfoSidebar.tsx src/components/PlanCard.tsx
git commit -m "feat: add InfoSidebar and PlanCard components"
```

---

## Task 22: 前端 — page.tsx 主页面

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: 更新 globals.css**

```css
/* src/app/globals.css */
@import "tailwindcss";

html,
body {
  height: 100%;
  margin: 0;
}

#__next {
  height: 100%;
}
```

- [ ] **Step 2: 创建主页面**

```typescript
// src/app/page.tsx
"use client";

import { useState } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { InfoSidebar } from "@/components/InfoSidebar";
import { PlanCard } from "@/components/PlanCard";

export default function Home() {
  const [collectedInfo, setCollectedInfo] = useState<Record<string, unknown>>({
    preferences: [],
    constraints: [],
  });
  const [phase, setPhase] = useState("info_gathering");
  const [planMarkdown, setPlanMarkdown] = useState<string | null>(null);

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Header */}
      <header className="border-b border-gray-200 px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900">
          智能旅游规划助手
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          告诉我你的旅行想法，我来帮你规划
        </p>
      </header>

      {/* Main */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat Area */}
        <div className="flex-1 flex flex-col">
          <ChatPanel
            onInfoUpdate={(info) =>
              setCollectedInfo((prev) => ({ ...prev, ...info }))
            }
            onPhaseUpdate={setPhase}
            onPlanUpdate={setPlanMarkdown}
          />
        </div>

        {/* Sidebar */}
        <div className="w-72 border-l border-gray-200">
          <InfoSidebar collectedInfo={collectedInfo} phase={phase} />
        </div>
      </div>

      {/* Plan Card Overlay */}
      {planMarkdown && (
        <div className="fixed bottom-4 right-4 w-96 z-50">
          <PlanCard
            markdown={planMarkdown}
            onSave={() => {
              // 下载 Markdown
              const blob = new Blob([planMarkdown], { type: "text/markdown" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `travel-plan-${new Date().toISOString().slice(0, 10)}.md`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            onRetry={() => setPlanMarkdown(null)}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx src/app/globals.css
git commit -m "feat: add main page with chat and sidebar layout"
```

---

## Task 23: 验证 — 启动开发服务器

**Files:**
- None (verification only)

- [ ] **Step 1: 检查 TypeScript 编译**

```bash
cd "D:/知识学习/travel-agent"
npx tsc --noEmit
```

Expected: 无错误输出

- [ ] **Step 2: 启动开发服务器**

```bash
npm run dev
```

Expected: 服务器在 http://localhost:3000 启动，无报错

- [ ] **Step 3: 浏览器访问验证**

打开 http://localhost:3000，确认：
- 双栏布局正常显示
- 左侧聊天区有输入框和欢迎文字
- 右侧信息面板显示"待收集"状态
- 输入框可以输入文字

- [ ] **Step 4: 最终 Commit**

```bash
git add -A
git commit -m "feat: complete travel agent MVP with LangGraph state machine"
```
