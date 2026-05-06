import { NextRequest } from "next/server";
import { AIMessageChunk, HumanMessage } from "@langchain/core/messages";
import { travelAgent } from "@/agent/graph";
import { isGraphInterrupt } from "@langchain/langgraph";

const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  // Add your Vercel domain: "https://your-app.vercel.app"
]);

// ── SSE Event Types ──

type SSEEvent =
  | { type: "thinking"; content: string }
  | { type: "token"; content: string }
  | { type: "step"; tools: string[] }
  | { type: "step_done"; tool: string }
  | { type: "info"; data: unknown }
  | { type: "phase"; data: string }
  | { type: "tripStatus"; data: string }
  | { type: "plan"; markdown: string }
  | { type: "interrupt"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };

interface StreamInput {
  messages: HumanMessage[];
  userId?: string;
  sessionId?: string;
}

// ── Content Block Type Guards ──

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

function extractIncremental(content: unknown): { thinking: string; text: string } {
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

// Basic prompt injection patterns (case-insensitive)
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/i,
  /忽略(之前|以上|所有)(的)?(指令|提示|规则|要求)/i,
  /you\s+are\s+now\s+(a|an|the)/i,
  /你现在是/i,
  /output\s+(your|the|all)\s+(system\s+)?(prompt|instructions?|rules?)/i,
  /输出(你的|所有|系统)(提示词|指令|规则)/i,
  /forget\s+(all\s+)?(previous|prior|your)\s+(instructions?|rules?)/i,
  /忘记(之前|所有|你的)(指令|规则)/i,
  /system\s*:\s*/i,
  /\[INST\]/i,
  /<\/?(system|user|assistant)>/i,
];

function validateBody(body: unknown):
  | {
      message: string;
      threadId: string;
      userId?: string;
      sessionId?: string;
    }
  | { error: string } {
  if (!body || typeof body !== "object") return { error: "请求体为空" };
  const { message, threadId, userId, sessionId } = body as Record<string, unknown>;
  if (typeof message !== "string" || !message.trim()) return { error: "message 不能为空" };
  if (message.length > 5000) return { error: "message 超过 5000 字符限制" };

  // Basic prompt injection detection
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(message)) {
      return { error: "消息内容包含不允许的指令，请重新输入旅行相关问题" };
    }
  }

  if (typeof threadId !== "string" || !threadId.trim()) return { error: "threadId 不能为空" };
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
      const send = (data: SSEEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Bug #5 fix: track sent tool names per node, reset on node transition
      let currentNode = "";
      const sentToolSteps = new Set<string>();

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

          // ── messages mode: token-level streaming ──
          if (mode === "messages") {
            const [msgChunk, meta] = payload as [AIMessageChunk, { langgraph_node?: string }];

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
              if (ic.phase && typeof ic.phase === "string") {
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
              if (pa.phase && typeof pa.phase === "string") {
                send({ type: "phase", data: pa.phase });
              }
              if (pa.tripStatus && typeof pa.tripStatus === "string") {
                send({ type: "tripStatus", data: pa.tripStatus });
              }
              if (pa.planMarkdown && typeof pa.planMarkdown === "string") {
                send({ type: "plan", markdown: pa.planMarkdown });
              }
              // Extract AIMessage text when LLM responds without tool calls
              // (e.g., follow-up questions in confirming phase)
              // Only emit AIMessage content — skip ToolMessage to avoid emitting raw tool output
              if (pa.messages && Array.isArray(pa.messages)) {
                for (const msg of pa.messages) {
                  if (
                    msg &&
                    typeof msg === "object" &&
                    "content" in msg &&
                    !("tool_call_id" in msg) // skip ToolMessage
                  ) {
                    const content = msg.content;
                    if (typeof content === "string" && content.length > 0) {
                      send({ type: "token", content });
                    } else if (Array.isArray(content)) {
                      for (const block of content) {
                        if (
                          block &&
                          typeof block === "object" &&
                          "type" in block &&
                          block.type === "text" &&
                          "text" in block &&
                          typeof block.text === "string"
                        ) {
                          send({ type: "token", content: block.text });
                        }
                      }
                    }
                  }
                }
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
          // Log detailed error server-side
          console.error("[chat] Error:", error);
          // Send generic message to client
          send({
            type: "error",
            message: "服务暂时出现问题，请稍后重试",
          });
        }
      } finally {
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
