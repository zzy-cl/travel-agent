// src/lib/chat-utils.ts
// SSE 事件类型定义、输入校验、流式消息处理
//
// 这个文件是前端（ChatPanel）和后端（route.ts）之间的"协议层"。
// 定义了所有 SSE 事件类型和消息处理逻辑。
//
// ── SSE（Server-Sent Events）简介 ──
// SSE 是一种服务端向客户端的单向流式推送协议。
// 与 WebSocket 不同，SSE 基于 HTTP，天然支持跨域、自动重连。
// 数据格式: 每条消息以 "data: " 开头，以 "\n\n" 结尾。
//
// ── streamMode 说明 ──
// LangGraph 的 stream() 支持两种流模式:
// - "messages": 逐 token 流式输出（LLM 每生成一个 token 就推送）
// - "updates": 节点完成时批量推送（一个节点执行完后推送完整结果）
// 本项目同时使用两种模式: messages 用于实时显示打字效果，updates 用于更新侧边栏状态。

import type { AIMessageChunk } from "@langchain/core/messages";
import { isTextBlock } from "./agent-utils";

// ── SSE 事件类型定义 ──
// 前端 ChatPanel 根据 type 字段分发处理:
//
// thinking:    LLM 思考过程（thinking 模式下产生，展示为折叠块）
// token:       LLM 逐 token 输出（打字效果）
// replace:     节点完成后用干净文本替换流式阶段的文本
// step:        工具开始执行（显示进度条）
// step_done:   工具执行完成（标记 ✓）
// info:        collectedInfo 更新（侧边栏刷新）
// phase:       阶段变更（info_gathering → confirming → done）
// tripStatus:  旅行状态变更（planning → ongoing → completed）
// plan:        旅行计划 Markdown（展示 PlanCard）
// interrupt:   需要用户确认（显示确认卡片）
// error:       错误消息
// done:        流结束

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

// ── Content Block 类型守卫 ──
// LLM 的 AIMessageChunk.content 可能是多种 content block 的数组:
// - { type: "text", text: "..." } — 普通文本
// - { type: "thinking", thinking: "..." } — 思考过程
// - { type: "tool_use", id: "...", name: "...", input: {...} } — 工具调用
// 这些类型守卫用于区分不同类型的 block。

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

/**
 * 从流式 chunk 中提取 thinking 和 text 内容。
 *
 * 在 thinking 模式下，LLM 会交替输出 thinking block 和 text block:
 * [{ type: "thinking", thinking: "让我想想..." }, { type: "text", text: "北京是..." }]
 *
 * 这个函数将它们分别提取出来，供前端分别渲染。
 */
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

// ── Prompt Injection 检测 ──
// 用户可能通过输入恶意指令试图操控 LLM 行为（如"忽略之前的指令"）。
// 这些正则在消息到达 LLM 之前进行拦截。
// 覆盖中英文常见的注入模式。

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/i,
  /忽略(之前|以上|所有)(的)?(指令|提示|规则|要求)/i,
  /you\s+are\s+now\s+(a|an|the)/i,
  /你现在是/i,
  /output\s+(your|the|all)\s+(system\s+)?(prompt|instructions?|rules?)/i,
  /输出(你的|所有|系统)(提示词|指令|规则)/i,
  /forget\s+(all\s+)?(previous|prior|your)\s+(instructions?|rules?)/i,
  /忘记(之前|所有|你的)(指令|规则)/i,
  /system\s*:\s*/i, // 伪造 system 消息
  /\[INST\]/i, // 伪造 Llama 格式
  /<\/?(system|user|assistant)>/i, // 伪造 XML 标签
];

/**
 * 校验请求体 + 检测 prompt injection。
 *
 * 这是 API 路由的第一道防线:
 * 1. 检查必填字段（message、threadId）
 * 2. 检查消息长度（防止超长输入攻击）
 * 3. 逐条匹配注入模式（中英文）
 *
 * 返回校验后的结构化数据，或错误信息。
 */
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

/**
 * 处理 LangGraph 的流式 chunk，生成 SSE 事件。
 *
 * LangGraph stream() 的 "messages" 模式会推送 [AIMessageChunk, metadata] 元组。
 * metadata.langgraph_node 告诉我们当前是哪个节点在输出。
 *
 * 处理逻辑:
 * 1. 检测节点切换 → 清空已发送的 tool step 记录
 * 2. 提取 thinking/text → 作为 token 事件发送
 * 3. 检测 tool_call_chunks → 作为 step 事件发送（工具开始执行）
 */
export function processMessagesChunk(
  payload: unknown,
  sentToolSteps: Set<string>,
  currentNode: string,
): { actions: Array<{ type: "send"; event: SSEEvent }>; currentNode: string } {
  const actions: Array<{ type: "send"; event: SSEEvent }> = [];
  let node = currentNode;

  const [msgChunk, meta] = payload as [AIMessageChunk, { langgraph_node?: string }];

  // 节点切换: 清空 tool step 记录（新节点的工具需要重新显示）
  if (meta.langgraph_node && meta.langgraph_node !== node) {
    node = meta.langgraph_node;
    sentToolSteps.clear();
  }

  // 提取并发送 thinking/text 内容
  const { thinking, text } = extractIncremental(msgChunk.content);
  if (thinking) actions.push({ type: "send", event: { type: "thinking", content: thinking } });
  if (text) actions.push({ type: "send", event: { type: "token", content: text } });

  // 检测 tool_call_chunks → LLM 开始调用工具
  // sentToolSteps 用于去重: 同一个工具只发送一次 step 事件
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
