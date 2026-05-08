import { NextRequest } from "next/server";
import { HumanMessage } from "@langchain/core/messages";
import { travelAgent } from "@/agent/graph";
import { type SSEEvent, validateBody, processMessagesChunk } from "@/lib/chat-utils";

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
  const body = await req.json().catch(() => null);
  const parsed = validateBody(body);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  const { message, threadId, userId, sessionId } = parsed;

  const config = {
    configurable: { thread_id: threadId },
    streamMode: ["messages", "updates"] as ("messages" | "updates")[],
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (data: SSEEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      let currentNode = "";
      const sentToolSteps = new Set<string>();

      function markAllStepsDone(): void {
        for (const name of sentToolSteps) {
          send({ type: "step_done", tool: name });
        }
        sentToolSteps.clear();
      }

      function emitNodeProps(nodeOutput: Record<string, unknown>): void {
        // 发送清理后的消息文本，替换流式阶段已推送的含 JSON 文本
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
        const streamInput: StreamInput = {
          messages: [new HumanMessage(message)],
        };
        if (userId) streamInput.userId = userId;
        if (sessionId) streamInput.sessionId = sessionId;

        const eventStream = await travelAgent.stream(streamInput, config);

        for await (const rawChunk of eventStream) {
          const chunk = rawChunk as [string, unknown];
          const mode = chunk[0];
          const payload = chunk[1];

          if (mode === "messages") {
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
            const data = payload as Record<string, unknown>;

            if (data.info_collector) {
              emitNodeProps(data.info_collector as Record<string, unknown>);
              markAllStepsDone();
            }

            if (data.plan_agent) {
              emitNodeProps(data.plan_agent as Record<string, unknown>);
              markAllStepsDone();
            }

            if (data.save) {
              send({ type: "phase", data: "done" });
            }
          }
        }

        send({ type: "done" });
      } catch (error: unknown) {
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
        closed = true;
        controller.close();
      }
    },
  });

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
