// src/app/api/chat/route.ts
// SSE 流式 API 端点 — 前端与 LangGraph Agent 的桥梁
//
// 这是整个应用的"枢纽"。前端发送 POST /api/chat，这里:
// 1. 校验输入（validateBody + injection 检测）
// 2. 调用 LangGraph Agent（travelAgent.stream()）
// 3. 将 Agent 的输出转为 SSE 事件流推送给前端
//
// ── SSE（Server-Sent Events）工作原理 ──
//
// 浏览器端: fetch("/api/chat") → 拿到一个 ReadableStream → 逐行读取
// 服务端: new Response(stream) → 不断写入 "data: {...}\n\n" → 最后关闭
//
// 与普通 API 的区别:
// - 普通 API: 等待全部处理完 → 一次性返回（用户要等很久）
// - SSE: 边处理边返回（用户立即看到打字效果、工具执行进度）
//
// ── ReadableStream + SSE 格式 ──
// 每条 SSE 消息格式: "data: {JSON}\n\n"
// 前端通过 reader.read() 逐块读取，按 "\n" 分割后解析 JSON。
//
// ── streamMode 详解 ──
// travelAgent.stream() 同时使用两种模式:
// - "messages": LLM 每生成一个 token 就推送 → 前端实时显示打字效果
// - "updates": 一个节点执行完后推送完整结果 → 前端更新侧边栏/计划卡片
//
// 流中的每个 chunk 是一个 [mode, payload] 元组:
// - ["messages", [AIMessageChunk, metadata]] → 逐 token
// - ["updates", { node_name: state_update }] → 节点完成

import { NextRequest } from "next/server";
import { HumanMessage } from "@langchain/core/messages";
import { travelAgent } from "@/agent/graph";
import { type SSEEvent, validateBody, processMessagesChunk } from "@/lib/chat-utils";

// 允许的前端域名（CORS 白名单）
const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  // Add your Vercel domain: "https://your-app.vercel.app"
]);

interface StreamInput {
  messages: HumanMessage[];
  userId?: string;
  sessionId?: string;
}

export async function POST(req: NextRequest) {
  // 1. 解析并校验请求体
  const body = await req.json().catch(() => null);
  const parsed = validateBody(body);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  const { message, threadId, userId, sessionId } = parsed;

  // 2. LangGraph 配置: thread_id 用于区分不同对话的状态快照
  const config = {
    configurable: { thread_id: threadId },
    streamMode: ["messages", "updates"] as ("messages" | "updates")[],
  };

  // 3. 创建 SSE 流
  // ReadableStream: Web API 的流式响应体，可以分块写入数据
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // closed 标志: 防止在客户端断开后继续写入（避免 ERR_INVALID_STATE 错误）
      let closed = false;
      const send = (data: SSEEvent) => {
        if (closed) return;
        try {
          // SSE 格式: "data: {JSON}\n\n"
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // 跟踪当前节点和已发送的 tool step（用于去重和节点切换检测）
      let currentNode = "";
      const sentToolSteps = new Set<string>();

      /** 标记所有工具步骤为完成状态 */
      function markAllStepsDone(): void {
        for (const name of sentToolSteps) {
          send({ type: "step_done", tool: name });
        }
        sentToolSteps.clear();
      }

      /**
       * 发送节点的输出属性。
       *
       * 当一个节点执行完毕后（"updates" 模式），这个函数提取节点返回的状态字段，
       * 转为 SSE 事件发送给前端:
       * - messages → "replace" 事件（用干净文本替换流式阶段的文本）
       * - collectedInfo → "info" 事件（侧边栏更新）
       * - phase → "phase" 事件
       * - planMarkdown → "plan" 事件（展示计划卡片）
       * - interruptMessage → "interrupt" 事件（展示确认卡片）
       */
      function emitNodeProps(nodeOutput: Record<string, unknown>): void {
        const messages = nodeOutput.messages as Array<{ content: unknown }> | undefined;
        if (messages?.length) {
          const lastMsg = messages[messages.length - 1];
          const content = lastMsg.content;
          let cleanText = "";
          if (typeof content === "string") {
            cleanText = content;
          } else if (Array.isArray(content)) {
            const textParts: string[] = [];
            for (const block of content) {
              if (
                typeof block === "object" &&
                block !== null &&
                "type" in block &&
                block.type === "text" &&
                "text" in block &&
                typeof block.text === "string"
              ) {
                textParts.push(block.text);
              }
            }
            cleanText = textParts.join("");
          }
          if (cleanText.trim()) {
            send({ type: "replace", content: cleanText });
          }
        }

        if (nodeOutput.collectedInfo) {
          send({ type: "info", data: nodeOutput.collectedInfo as Record<string, unknown> });
        }
        if (typeof nodeOutput.phase === "string") send({ type: "phase", data: nodeOutput.phase });
        if (typeof nodeOutput.tripStatus === "string")
          send({ type: "tripStatus", data: nodeOutput.tripStatus });
        if (typeof nodeOutput.planMarkdown === "string")
          send({ type: "plan", markdown: nodeOutput.planMarkdown });
        if (typeof nodeOutput.interruptMessage === "string")
          send({ type: "interrupt", message: nodeOutput.interruptMessage });
      }

      try {
        // 4. 构建输入并启动 Agent 流式执行
        const streamInput: StreamInput = {
          messages: [new HumanMessage(message)],
        };
        if (userId) streamInput.userId = userId;
        if (sessionId) streamInput.sessionId = sessionId;

        // travelAgent.stream() 返回一个 AsyncIterable
        // 每次迭代产出一个 chunk: [mode, payload]
        const eventStream = await travelAgent.stream(streamInput, config);

        // 5. 消费流式输出
        for await (const rawChunk of eventStream) {
          const chunk = rawChunk as [string, unknown];
          const mode = chunk[0]; // "messages" 或 "updates"
          const payload = chunk[1];

          if (mode === "messages") {
            // "messages" 模式: 逐 token 流式输出
            // processMessagesChunk 提取 thinking/text/tool_call 信息
            const { actions, currentNode: newNode } = processMessagesChunk(
              payload,
              sentToolSteps,
              currentNode,
            );
            currentNode = newNode;
            for (const action of actions) {
              if (action.type === "send") send(action.event);
            }
            continue;
          }

          if (mode === "updates") {
            // "updates" 模式: 节点执行完毕，推送完整结果
            const data = payload as Record<string, unknown>;

            // info_collector 节点完成
            if (data.info_collector) {
              emitNodeProps(data.info_collector as Record<string, unknown>);
              markAllStepsDone();
            }

            // plan_agent 节点完成
            if (data.plan_agent) {
              emitNodeProps(data.plan_agent as Record<string, unknown>);
              markAllStepsDone();
            }

            // save 节点完成
            if (data.save) {
              send({ type: "phase", data: "done" });
            }
          }
        }

        // 6. 流结束
        send({ type: "done" });
      } catch (error: unknown) {
        // 7. 错误处理: 将技术错误转为用户友好的提示
        console.error("[chat] Error:", error);
        const msg = error instanceof Error ? error.message : String(error);
        const userMsg =
          msg.includes("ECONNRESET") || msg.includes("terminated")
            ? "AI 服务连接不稳定，请稍后重试"
            : msg.includes("429")
              ? "请求太频繁，请稍后再试"
              : "服务暂时出现问题，请稍后重试";
        send({ type: "error", message: userMsg });
      } finally {
        // 8. 关闭流（无论成功/失败）
        closed = true;
        controller.close();
      }
    },
  });

  // 9. 返回 SSE 响应
  // Content-Type: text/event-stream 告诉浏览器这是 SSE 流
  // Cache-Control: no-cache 防止代理/CDN 缓存
  const origin = req.headers.get("origin");
  const corsHeaders: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Content-Type-Options": "nosniff",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    corsHeaders["Access-Control-Allow-Origin"] = origin;
  }

  return new Response(stream, { headers: corsHeaders });
}
