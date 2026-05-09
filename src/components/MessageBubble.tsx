// src/components/MessageBubble.tsx
// 消息气泡组件 — 渲染单条消息（用户/AI）
//
// ── 特殊处理 ──
// 1. AI 消息支持 Markdown 渲染（表格、代码块、数学公式等）
// 2. AI 消息支持 thinking 块（LLM 思考过程的折叠展示）
// 3. thinking 块解析: 从 content 中提取 <think>...</think> 标签
//
// ── Markdown 渲染插件 ──
// - remarkGfm: GitHub Flavored Markdown（表格、删除线等）
// - remarkMath: LaTeX 数学公式
// - rehypeKatex: 数学公式渲染
// - rehypeHighlight: 代码语法高亮
// - rehypeSanitize: XSS 防护（清理危险 HTML）

"use client";

import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeSanitize, rehypeKatex, rehypeHighlight];

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

interface ContentPart {
  type: "thinking" | "text";
  content: string;
}

/**
 * 解析消息内容，提取 thinking 块。
 *
 * LLM 在 thinking 模式下会输出:
 * "<think>思考过程</think>最终回答"
 *
 * 这个函数将它们拆分为 thinking 和 text 两种 part，
 * 供 ThinkingBlock 和 MarkdownBody 分别渲染。
 *
 * 特殊处理: 跳过代码块中的 <think> 标签（避免误识别）。
 */
function parseContent(raw: string): ContentPart[] {
  const parts: ContentPart[] = [];
  const regex = /<think>([\s\S]*?)<\/think>/g;
  let lastIndex = 0;

  for (const match of raw.matchAll(regex)) {
    if (match.index! > lastIndex) {
      parts.push({ type: "text", content: raw.slice(lastIndex, match.index!) });
    }
    // 简单启发式: 检查前面的 ``` 数量，奇数说明在代码块内
    const beforeMatch = raw.slice(0, match.index!);
    const backtickCount = (beforeMatch.match(/```/g) || []).length;
    if (backtickCount % 2 === 0) {
      parts.push({ type: "thinking", content: match[1].trim() });
    } else {
      const end = match.index! + match[0].length;
      parts.push({ type: "text", content: raw.slice(lastIndex, end) });
      lastIndex = end;
      continue;
    }
    lastIndex = match.index! + match[0].length;
  }

  if (lastIndex < raw.length) {
    parts.push({ type: "text", content: raw.slice(lastIndex) });
  }

  return parts.length ? parts : [{ type: "text", content: raw }];
}

/** 可折叠的 thinking 块 */
function ThinkingBlock({ content, forceExpand }: { content: string; forceExpand?: boolean }) {
  const [manualOpen, setManualOpen] = useState(false);
  const expanded = forceExpand || manualOpen;

  return (
    <div className="thinking-block">
      <button
        className="thinking-toggle"
        onClick={() => {
          if (!forceExpand) setManualOpen(!manualOpen);
        }}
        type="button"
      >
        <svg
          className={`thinking-arrow ${expanded ? "expanded" : ""}`}
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M4 2.5l4 3.5-4 3.5" />
        </svg>
        <span>{forceExpand ? "思考中..." : expanded ? "收起思考过程" : "查看思考过程"}</span>
      </button>
      {expanded && <div className="thinking-content">{content}</div>}
    </div>
  );
}

export function MessageBubble({ role, content, isStreaming }: MessageBubbleProps) {
  const parts = useMemo(() => parseContent(content), [content]);

  // 思考进行中: 正在流式输出且尚未有正文内容
  const hasTextContent = parts.some((p) => p.type === "text" && p.content.trim());

  if (role === "user") {
    return (
      <div className="msg msg-user">
        <div className="bubble">{content}</div>
      </div>
    );
  }

  return (
    <div className={`msg msg-ai ${isStreaming ? "msg-streaming" : ""}`}>
      <div className="bubble">
        {parts.some((p) => p.type === "thinking") ? (
          parts.map((part, i) =>
            part.type === "thinking" ? (
              <ThinkingBlock
                key={`think-${i}`}
                content={part.content}
                forceExpand={!!(isStreaming && !hasTextContent)}
              />
            ) : (
              <div key={`text-${i}`} className="markdown-body">
                <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
                  {part.content}
                </ReactMarkdown>
              </div>
            ),
          )
        ) : (
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
