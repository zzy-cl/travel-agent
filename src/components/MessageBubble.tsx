"use client";

import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex, rehypeHighlight];

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

interface ContentPart {
  type: "thinking" | "text";
  content: string;
}

function parseContent(raw: string): ContentPart[] {
  const parts: ContentPart[] = [];
  const regex = /<think>([\s\S]*?)<\/think>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: raw.slice(lastIndex, match.index) });
    }
    parts.push({ type: "thinking", content: match[1].trim() });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < raw.length) {
    parts.push({ type: "text", content: raw.slice(lastIndex) });
  }

  return parts.length ? parts : [{ type: "text", content: raw }];
}

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

  // 思考进行中：正在流式输出且尚未有正文内容
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
