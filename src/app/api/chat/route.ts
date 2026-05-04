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

          // process_info 节点 — 发送 collectedInfo 更新
          if (chunk.process_info) {
            if (chunk.process_info.collectedInfo) {
              send({
                type: "info",
                data: chunk.process_info.collectedInfo,
              });
            }
            if (chunk.process_info.phase) {
              send({ type: "phase", data: chunk.process_info.phase });
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
