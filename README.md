# 智能旅游规划助手 (Travel Agent)

基于 AI 的引导式旅行规划助手。你只需说出旅行想法，Agent 会逐步引导你完善需求，自动搜索景点、天气、酒店等实时信息，最终生成详细的旅行计划。

## 技术栈

| 层次       | 技术                                                |
| ---------- | --------------------------------------------------- |
| 前端       | Next.js 16 + React 19 + Tailwind CSS 4 + TypeScript |
| Agent 引擎 | LangGraph (StateGraph + 条件路由)                   |
| LLM        | DeepSeek v4（通过 Anthropic 兼容 API）              |
| 外部工具   | 高德地图 API / 和风天气 API / SearXNG               |
| 数据校验   | Zod v4                                              |

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量（复制 .env.example 为 .env 并填写）
cp .env.example .env

# 3. 启动开发服务器
npm run dev

# 4. 打开 http://localhost:3000
```

## 环境变量

| 变量                 | 说明                     | 默认值                               |
| -------------------- | ------------------------ | ------------------------------------ |
| `ANTHROPIC_API_KEY`  | DeepSeek API Key（必填） | —                                    |
| `ANTHROPIC_BASE_URL` | API 地址                 | `https://api.deepseek.com/anthropic` |
| `LLM_MODEL`          | 模型名称                 | `deepseek-v4-pro`                    |
| `LLM_THINKING`       | 启用/禁用思考模式        | `enabled`                            |
| `QWEATHER_API_KEY`   | 和风天气 API Key         | —                                    |
| `AMAP_API_KEY`       | 高德地图 API Key         | —                                    |
| `SEARXNG_BASE_URL`   | SearXNG 搜索实例 URL     | —                                    |

## 对话流程

```
用户说旅行想法
    → Agent 逐步提问收集信息（目的地/天数/人数/偏好等）
    → 信息确认后，用户点击"开始生成"
    → Agent 自动搜索天气、景点、周边信息
    → 生成详细旅行计划（每日行程表 + 预算 + 注意事项）
    → 用户确认或提出修改
    → 保存/下载计划
```

## 脚本

| 命令                | 说明                |
| ------------------- | ------------------- |
| `npm run dev`       | 启动开发服务器      |
| `npm run build`     | 生产构建            |
| `npm run lint`      | ESLint 检查         |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run format`    | Prettier 格式化     |

## 项目结构

```
src/
├── app/                    # Next.js App Router
│   ├── api/chat/route.ts   # SSE 流式聊天 API
│   ├── page.tsx            # 主页面
│   └── globals.css         # 全局样式
├── agent/                  # LangGraph Agent
│   ├── graph.ts            # 状态机定义
│   ├── state.ts            # 状态类型
│   ├── nodes/              # 图节点
│   ├── prompts/            # System Prompt
│   └── tools/              # 工具实现
├── components/             # React 组件
├── schemas/                # Zod 数据模型
└── lib/                    # 工具库（缓存/HTTP/LLM）
```

## License

MIT
