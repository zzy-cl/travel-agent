import { NextRequest } from "next/server";
import { AIMessageChunk, HumanMessage } from "@langchain/core/messages";
import { travelAgent } from "@/agent/graph";
import { isGraphInterrupt } from "@langchain/langgraph";

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
  userId?: string;
  sessionId?: string;
} | { error: string } {
  if (!body || typeof body !== "object") return { error: "请求体为空" };
  const { message, threadId, userId, sessionId } = body as Record<string, unknown>;
  if (typeof message !== "string" || !message.trim())
    return { error: "message 不能为空" };
  if (message.length > 5000) return { error: "message 超过 5000 字符限制" };
  if (typeof threadId !== "string" || !threadId.trim())
    return { error: "threadId 不能为空" };
  const result: { message: string; threadId: string; userId?: string; sessionId?: string } = {
    message: message.trim(),
    threadId: threadId.trim(),
  };
  if (typeof userId === "string" && userId.trim()) result.userId = userId.trim();
  if (typeof sessionId === "string" && sessionId.trim()) result.sessionId = sessionId.trim();
  return result;
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
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
        );
      };

      // Bug #5 fix: track sent tool names per node, reset on node transition
      let currentNode = "";
      const sentToolSteps = new Set<string>();

      try {
        const streamInput: Record<string, unknown> = {
          messages: [new HumanMessage(message)],
        };
        if (userId) streamInput.userId = userId;
        if (sessionId) streamInput.sessionId = sessionId;

        const eventStream = await travelAgent.stream(
          streamInput,
          config,
        );

        for await (const rawChunk of eventStream) {
          const chunk = rawChunk as [string, unknown];
          const mode = chunk[0];
          const payload = chunk[1];

          // ── messages mode: token-level streaming ──
          if (mode === "messages") {
            const [msgChunk, meta] = payload as [
              AIMessageChunk,
              { langgraph_node?: string },
            ];

            // Reset tool step tracker on node transition (Bug #5 fix)
            if (meta.langgraph_node && meta.langgraph_node !== currentNode) {
              currentNode = meta.langgraph_node;
              sentToolSteps.clear();
            }

            const { thinking, text } = extractIncremental(msgChunk.content);
            if (thinking) send({ type: "thinking", content: thinking });
            if (text) send({ type: "token", content: text });

            // Tool call steps — emit once per unique tool name (Bug #5 fix)
            if (msgChunk.tool_call_chunks?.length) {
              for (const tc of msgChunk.tool_call_chunks) {
                if (tc.name && !sentToolSteps.has(tc.name)) {
                  sentToolSteps.add(tc.name);
                  send({ type: "step", tools: [tc.name] });
                }
              }
            }
            continue;
          }

          // ── updates mode: node-level state updates ──
          if (mode === "updates") {
            const data = payload as Record<string, unknown>;

            // info_collector updates
            if (data.info_collector) {
              const ic = data.info_collector as Record<string, unknown>;
              if (ic.collectedInfo) {
                send({ type: "info", data: ic.collectedInfo });
              }
              if (ic.phase) {
                send({ type: "phase", data: ic.phase });
              }
              // Mark all pending tool steps as done
              for (const name of sentToolSteps) {
                send({ type: "step_done", tool: name });
              }
              sentToolSteps.clear();
            }

            // plan_agent updates
            if (data.plan_agent) {
              const pa = data.plan_agent as Record<string, unknown>;
              if (pa.phase) {
                send({ type: "phase", data: pa.phase });
              }
              if (pa.tripStatus) {
                send({ type: "tripStatus", data: pa.tripStatus });
              }
              if (pa.planMarkdown && typeof pa.planMarkdown === "string") {
                send({ type: "plan", markdown: pa.planMarkdown });
              }
              // Mark all pending tool steps as done
              for (const name of sentToolSteps) {
                send({ type: "step_done", tool: name });
              }
              sentToolSteps.clear();
            }

            // save — emit done phase
            if (data.save) {
              send({ type: "phase", data: "done" });
            }
          }
        }

        send({ type: "done" });
      } catch (error: unknown) {
        if (isGraphInterrupt(error)) {
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
