// SSE event types and helpers for the chat API route

import type { AIMessageChunk } from "@langchain/core/messages";
import { isTextBlock } from "./agent-utils";

// ── SSE Event Types ──

export type SSEEvent =
  | { type: "thinking"; content: string }
  | { type: "token"; content: string }
  | { type: "replace"; content: string }
  | { type: "step"; tools: string[] }
  | { type: "step_done"; tool: string }
  | { type: "info"; data: unknown }
  | { type: "phase"; data: string }
  | { type: "tripStatus"; data: string }
  | { type: "plan"; markdown: string }
  | { type: "interrupt"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };

// ── Content Block Type Guards ──

interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

function isThinkingBlock(block: unknown): block is ThinkingBlock {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as ThinkingBlock).type === "thinking" &&
    typeof (block as ThinkingBlock).thinking === "string"
  );
}

export function extractIncremental(content: unknown): { thinking: string; text: string } {
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

// ── Prompt Injection Detection ──

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

export function validateBody(body: unknown):
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

/** Process a stream chunk from LangGraph and collect SSE emissions */
export function processMessagesChunk(
  payload: unknown,
  sentToolSteps: Set<string>,
  currentNode: string,
): { actions: Array<{ type: "send"; event: SSEEvent }>; currentNode: string } {
  const actions: Array<{ type: "send"; event: SSEEvent }> = [];
  let node = currentNode;

  const [msgChunk, meta] = payload as [AIMessageChunk, { langgraph_node?: string }];

  if (meta.langgraph_node && meta.langgraph_node !== node) {
    node = meta.langgraph_node;
    sentToolSteps.clear();
  }

  const { thinking, text } = extractIncremental(msgChunk.content);
  if (thinking) actions.push({ type: "send", event: { type: "thinking", content: thinking } });
  if (text) actions.push({ type: "send", event: { type: "token", content: text } });

  if (msgChunk.tool_call_chunks?.length) {
    for (const tc of msgChunk.tool_call_chunks) {
      if (tc.name && !sentToolSteps.has(tc.name)) {
        sentToolSteps.add(tc.name);
        actions.push({ type: "send", event: { type: "step", tools: [tc.name] } });
      }
    }
  }

  return { actions, currentNode: node };
}
