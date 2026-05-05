// src/app/api/chat/route.ts
import { NextRequest } from "next/server";
import {
  AIMessageChunk,
  HumanMessage,
} from "@langchain/core/messages";
import { travelAgent } from "@/agent/graph";

interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}
interface TextBlock {
  type: "text";
  text: string;
}

function isThinkingBlock(block: unknown): block is ThinkingBlock {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as ThinkingBlock).type === "thinking" &&
    typeof (block as ThinkingBlock).thinking === "string"
  );
}
function isTextBlock(block: unknown): block is TextBlock {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as TextBlock).type === "text" &&
    typeof (block as TextBlock).text === "string"
  );
}

function extractIncremental(
  content: unknown,
): { thinking: string; text: string } {
  let thinking = "";
  let text = "";
  if (Array.isArray(content)) {
    for (const block of content) {
      if (isThinkingBlock(block)) thinking += block.thinking;
      else if (isTextBlock(block)) text += block.text;
    }
  } else if (typeof content === "string") {
    text = content;
  }
  return { thinking, text };
}

function validateBody(body: unknown): {
  message: string;
  threadId: string;
} | { error: string } {
  if (!body || typeof body !== "object") return { error: "请求体为空" };
  const { message, threadId } = body as Record<string, unknown>;
  if (typeof message !== "string" || !message.trim())
    return { error: "message 不能为空" };
  if (message.length > 5000) return { error: "message 超过 5000 字符限制" };
  if (typeof threadId !== "string" || !threadId.trim())
    return { error: "threadId 不能为空" };
  return { message: message.trim(), threadId: threadId.trim() };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = validateBody(body);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  const { message, threadId } = parsed;

  const config = {
    configurable: { thread_id: threadId },
    streamMode: ["messages", "updates"] as ("messages" | "updates")[],
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
        );
      };

      let sentToolStep = false;

      try {
        const eventStream = await travelAgent.stream(
          { messages: [new HumanMessage(message)] },
          config,
        );

        for await (const rawChunk of eventStream) {
          // LangGraph 1.2: chunk 是 [mode, payload] 元组
          const chunk = rawChunk as [string, unknown];
          const mode = chunk[0];
          const payload = chunk[1];

          // ── messages 模式：逐 token 流式输出 ──
          if (mode === "messages") {
            const [msgChunk, meta] = payload as [
              AIMessageChunk,
              { langgraph_node?: string },
            ];

            // content 增量（thinking / text）
            const { thinking, text } = extractIncremental(msgChunk.content);
            if (thinking) send({ type: "thinking", content: thinking });
            if (text) send({ type: "token", content: text });

            // 工具调用开始
            if (
              msgChunk.tool_call_chunks?.length &&
              meta.langgraph_node === "plan_agent" &&
              !sentToolStep
            ) {
              const names = msgChunk.tool_call_chunks
                .map((tc) => tc.name)
                .filter(Boolean) as string[];
              if (names.length) {
                send({ type: "step", tools: names });
                sentToolStep = true;
              }
            }
            continue;
          }

          // ── updates 模式：节点级别状态更新 ──
          if (mode === "updates") {
            const data = payload as Record<string, unknown>;

            // reset tool step tracker on node transitions
            if (data.info_agent || data.plan_agent) sentToolStep = false;

            // process_info
            if (data.process_info) {
              const pi = data.process_info as Record<string, unknown>;
              if (pi.collectedInfo) {
                send({ type: "info", data: pi.collectedInfo });
              }
              if (pi.phase) {
                send({ type: "phase", data: pi.phase });
              }
            }

            // plan_tools
            if (data.plan_tools) {
              const pt = data.plan_tools as {
                messages?: Array<Record<string, unknown>>;
              };
              if (pt.messages?.length) {
                for (const msg of pt.messages) {
                  if (
                    msg.name === "submit_plan" &&
                    typeof msg.content === "string"
                  ) {
                    send({ type: "plan", markdown: msg.content });
                    send({ type: "step_done", tool: "submit_plan" });
                  } else if (msg.name) {
                    send({ type: "step_done", tool: msg.name });
                  }
                }
              }
            }

            // after_plan / save
            const stateUpdate = data.after_plan || data.save;
            if (stateUpdate && typeof stateUpdate === "object") {
              const su = stateUpdate as Record<string, unknown>;
              if (su.phase) {
                send({ type: "phase", data: su.phase });
              }
            }
          }
        }

        send({ type: "done" });
      } catch (error: unknown) {
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
