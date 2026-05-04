# 智能旅游 Agent 设计文档

## 概述

构建一个**引导式、渐进式**的旅游规划 Agent。用户提出模糊的旅行想法，Agent 逐步提问收集信息，确认后生成计划，再通过对话迭代优化。

### 核心理念

与"一次性生成"模式不同，本系统模拟真实旅行顾问的工作方式：先了解需求，再出方案，持续调整直到满意。

### 技术栈

| 层次 | 技术 |
|------|------|
| 前端 | Next.js 16 + React 19 + Tailwind CSS 4 + TypeScript |
| 流式传输 | Server-Sent Events (SSE) |
| Agent 引擎 | LangGraph (StateGraph + 条件路由 + interrupt) |
| LLM | OpenAI API (function calling) |
| 外部工具 | 高德地图 API + 和风天气 API + SearXNG |
| 数据验证 | Zod Schema |

## 对话流程

四个阶段，由 LangGraph 状态机控制流转：

```
用户模糊想法
  ↓
[信息收集] Agent 分析缺失信息 → 逐项提问
  ↓ （信息足够，Agent 调用 confirm_info 工具）
[信息确认] interrupt → 展示已收集信息，用户确认或补充
  ↓ （用户确认）
[计划生成] Agent 调用外部工具 → 生成初版计划
  ↓ （Agent 调用 submit_plan 工具）
[迭代优化] interrupt → 展示计划，用户反馈
  ↓
  ├─ 修改意见 → 回到计划生成（Agent 基于反馈调整）
  └─ 满意 → 保存 → END
```

## 状态机设计

### 状态结构

```typescript
AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  collectedInfo: Annotation<{
    destination?: string;
    days?: number;
    people?: number;
    dateRange?: string;
    budget?: string;
    preferences: string[];
    constraints: string[];
  }>({
    reducer: (_, newVal) => newVal,
    default: () => ({ preferences: [], constraints: [] }),
  }),
  phase: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "info_gathering",
  }),
});
```

- **messages**: 完整对话历史，给 LLM 看（"记忆"）
- **collectedInfo**: 结构化已收集信息，给程序用（路由判断 + 前端展示）
- **phase**: 当前阶段标记，控制路由

### 图结构

```
START → router
  router ──→ infoAgent ──→ afterInfoAgent
               ↑                ├─ 未确认 → router（继续提问）
               │                └─ 已确认 → interrupt → 更新 phase → router
               │
  router ──→ planAgent ──→ afterPlanAgent
               ↑    ↑          ├─ 需要工具 → tools → planAgent
               │    └──────────┘
               │                ├─ 已提交计划 → interrupt
               │                │    ├─ 用户满意 → save → END
               │                │    └─ 修改意见 → 更新 phase → router
               │                └─ 还在调工具 → tools
```

### 节点职责

| 节点 | 职责 | 可用工具 |
|------|------|---------|
| router | 读 phase，路由到对应 Agent | 无 |
| infoAgent | 分析缺失信息，提问，提取信息 | update_collected_info, confirm_info |
| planAgent | 调外部 API，生成/修改旅行计划 | search_attractions, search_nearby, get_weather, web_search, submit_plan |
| save | 保存计划 | 无 |

### 阶段转换信号

Agent 调用特定工具 = 阶段结束信号：

- `confirm_info` → 信息收集完毕，转入确认
- `submit_plan` → 计划生成完毕，转入迭代

LLM 自主判断"信息够不够"，比程序硬编码规则更智能。

### afterAgent 节点的判断逻辑

**afterInfoAgent**：检查 infoAgent 返回的 AIMessage 中是否包含 `confirm_info` 工具调用。包含则调用 `interrupt()` 让用户确认，否则返回空（继续下一轮提问）。更新 collectedInfo 的逻辑也在此节点：从 ToolMessage 中解析 `update_collected_info` 的返回值，合并到 state.collectedInfo。

**afterPlanAgent**：检查 planAgent 返回的 AIMessage 中是否包含 `submit_plan` 工具调用。包含则中断展示计划，否则检查是否有 tool_calls（需要执行工具），条件路由到 tools 或回到 planAgent。

### 会话管理

每个对话通过 `thread_id` 标识。前端生成 UUID 存入 localStorage，后续请求携带同一 thread_id。后端使用 MemorySaver 按 thread_id 隔离状态，支持多个对话并存。

## 工具设计

### 信息收集阶段工具

**update_collected_info** — 每轮都调，从用户回复中提取结构化信息

```typescript
const updateCollectedInfo = tool(
  async (info) => JSON.stringify(info),
  {
    name: "update_collected_info",
    description: "从用户回复中提取信息并更新。每次用户回答了问题都调用。",
    schema: collectedInfoSchema.partial(),
  }
);
```

**confirm_info** — 只在信息足够时调一次，信号工具

```typescript
const confirmInfo = tool(
  async () => "信息已确认",
  {
    name: "confirm_info",
    description: "当收集到足够信息后调用，表示信息收集完毕",
    schema: z.object({}),
  }
);
```

### 规划阶段工具

复用参考项目中的工具实现：

| 工具 | 来源 | 用途 |
|------|------|------|
| search_attractions | 参考项目 amap.ts | 搜索景点 |
| search_nearby | 参考项目 amap.ts | 搜索周边酒店/餐厅 |
| get_weather | 参考项目 weather.ts | 天气查询 |
| web_search | 参考项目 search.ts | 搜索最新信息 |
| submit_plan | 参考项目 submit-plan.ts | 提交最终计划（信号工具） |

## 数据模型

### collectedInfo Schema

```typescript
const collectedInfoSchema = z.object({
  destination: z.string().optional(),
  days: z.number().optional(),
  people: z.number().optional(),
  dateRange: z.string().optional(),
  budget: z.string().optional(),
  preferences: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
});
```

### travelPlan Schema

复用参考项目 plan-schema.ts 的完整结构：

- destination, overview, bestSeason
- accommodation (area, recommendation, estimatedCost)
- transportation (howToGetThere, localTransport)
- dailyPlans[] (day, title, activities[], meals[])
- foodRecommendations[]
- budget (total, breakdown[])
- warnings[]

## 前端设计

### 页面布局

双栏布局：
- **左侧聊天区**：对话气泡 + 流式渲染
- **右侧信息面板**：实时显示 collectedInfo 状态（已收集 ✓ / 待收集 ○）+ 当前阶段

### SSE 事件类型

| 事件 | 数据 | 前端处理 |
|------|------|---------|
| token | 文本片段 | 追加到当前 AI 消息 |
| info | collectedInfo 对象 | 更新右侧信息面板 |
| plan | 计划 JSON + Markdown | 渲染计划卡片 |
| done | 结束标记 | 结束流式状态 |
| error | 错误信息 | 显示错误提示 |

### refinement 阶段交互

计划生成后，聊天区下方出现：
1. 计划卡片 — 结构化展示每日行程、预算、注意事项
2. 快捷按钮 — "满意，保存" / "重新生成"
3. 用户继续用自然语言说修改意见

## Agent 提示词设计

### infoAgent System Prompt 要点

- 角色：热情的旅行顾问，用自然对话收集信息
- 必问清单：目的地、天数、人数、预算、偏好、日期、约束（老人/小孩/饮食禁忌等）
- 每轮只问 1-2 个问题，不要一次性问完
- 从用户回复中提取信息，调用 update_collected_info 更新
- 信息足够后调用 confirm_info，不要自行生成计划
- 回复风格：友好、简洁、带 emoji

### planAgent System Prompt 要点

- 角色：专业旅行规划师
- 输入：collectedInfo 作为上下文注入 prompt
- 工具使用规则：先查天气 → 搜景点 → 搜周边 → 生成计划
- 输出策略：先给天级框架，用户确认后可细化到小时
- 必须包含：概览、住宿、交通、每日行程、美食、预算、注意事项
- submit_plan 只调一次，用户确认后才调

## API Routes

| 路由 | 方法 | 职责 |
|------|------|------|
| /api/chat | POST | 接收用户消息，调用 LangGraph，SSE 流式返回 |
| /api/plan | GET | 获取当前计划 |
| /api/plan/export | GET | 导出计划为 Markdown 文件 |

## 项目结构

```
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx              # 主页面（聊天界面）
│   ├── globals.css
│   └── api/
│       └── chat/
│           └── route.ts      # SSE 流式聊天 API
├── components/
│   ├── ChatPanel.tsx         # 聊天面板
│   ├── MessageBubble.tsx     # 消息气泡
│   ├── InfoSidebar.tsx       # 信息面板
│   ├── PlanCard.tsx          # 计划卡片
│   └── StreamingText.tsx     # 流式文本渲染
├── agent/
│   ├── graph.ts              # LangGraph 状态机定义
│   ├── state.ts              # AgentState Annotation
│   ├── nodes/
│   │   ├── router.ts         # 路由节点
│   │   ├── info-agent.ts     # 信息收集 Agent
│   │   ├── plan-agent.ts     # 规划 Agent
│   │   └── save.ts           # 保存节点
│   ├── prompts/
│   │   ├── info.ts           # 信息收集 prompt
│   │   └── plan.ts           # 规划 prompt
│   └── tools/
│       ├── index.ts
│       ├── confirm-info.ts
│       ├── update-info.ts
│       ├── amap.ts
│       ├── weather.ts
│       ├── search.ts
│       └── submit-plan.ts
├── schemas/
│   ├── collected-info.ts
│   └── travel-plan.ts
└── lib/
    ├── llm.ts                # OpenAI 模型配置
    ├── cache.ts              # LRU 缓存
    └── fetch-utils.ts        # HTTP 工具函数
```

## 环境变量

```
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://...     # 可选
AMAP_API_KEY=xxx
QWEATHER_API_KEY=xxx
SEARXNG_BASE_URL=https://..
```

## 与参考项目的关系

参考项目 `D:\知识学习\LangChain` 提供了代码语法和工具实现的参考。以下部分可直接复用（调整 import 路径）：

- `src/tools/amap.ts` — 高德地图工具
- `src/tools/weather.ts` — 和风天气工具
- `src/tools/search.ts` — Web 搜索工具
- `src/tools/submit-plan.ts` — 计划提交工具
- `src/tools/plan-schema.ts` — 计划 Zod schema
- `src/utils/cache.ts` — LRU 缓存
- `src/utils/fetch-utils.ts` — HTTP 工具函数

以下部分需要重新设计：

- `src/human-in-loop/travel-agent.ts` — 从单 Agent 改为多阶段状态机
- `src/streaming/travel-cli.ts` — 从 CLI 改为 SSE API
- 新增 infoAgent、router、collectedInfo 等引导式交互逻辑
