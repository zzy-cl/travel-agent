"use client";

import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from "react";
import { MessageBubble } from "./MessageBubble";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface StepItem {
  id: string;
  label: string;
  status: "pending" | "running" | "done";
}

export interface ChatPanelHandle {
  sendMessage: (text: string) => void;
}

interface ChatPanelProps {
  onInfoUpdate: (info: Record<string, unknown>) => void;
  onPhaseUpdate: (phase: string) => void;
  onPlanUpdate: (markdown: string) => void;
  onTripStatusUpdate?: (status: string) => void;
}

const SUGGESTIONS = [
  "🌸 我想去云南玩5天",
  "🏝️ 厦门3天亲子游",
  "🍜 成都美食之旅",
  "🏔️ 川西自驾7天",
];

const TOOL_LABELS: Record<string, string> = {
  get_weather: "查询目的地天气",
  search_attractions: "搜索热门景点",
  search_nearby: "搜索周边酒店和餐厅",
  web_search: "搜索最新旅游资讯",
  update_collected_info: "记录旅行信息",
  confirm_info: "确认信息完整",
  submit_plan: "正在生成旅行计划...",
  get_traffic: "查询实时交通状况",
  get_attraction_detail: "查询景点详细信息",
  optimize_route: "优化游览路线",
  export_markdown: "导出 Markdown 文件",
  export_json: "导出 JSON 文件",
  save_preferences: "保存旅行偏好",
  load_preferences: "加载旅行偏好",
};

export const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(function ChatPanel(
  { onInfoUpdate, onPhaseUpdate, onPlanUpdate, onTripStatusUpdate },
  ref,
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [steps, setSteps] = useState<StepItem[]>([]);
  const [threadId] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("travel-thread-id");
      if (stored) return stored;
      const id = crypto.randomUUID();
      localStorage.setItem("travel-thread-id", id);
      return id;
    }
    // SSR fallback: simple random ID (replaced on client hydration)
    return `ssr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;
  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, steps, scrollToBottom]);

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleSubmit = useCallback(async (text?: string) => {
    const userMessage = (text || inputRef.current).trim();
    if (!userMessage || isStreamingRef.current) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsStreaming(true);
    setSteps([]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage, threadId }),
        signal: controller.signal,
      });

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let assistantContent = "";
      let allThinking = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));

            const updateMessage = () => {
              const display = allThinking
                ? `<think>${allThinking}</think>\n${assistantContent}`
                : assistantContent;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: "assistant",
                  content: display,
                };
                return updated;
              });
            };

            switch (data.type) {
              case "thinking":
                allThinking += data.content;
                updateMessage();
                break;

              case "token":
                assistantContent += data.content;
                updateMessage();
                break;

              case "step": {
                const toolNames: string[] = data.tools || [];
                setSteps((prev) => {
                  const next = [...prev];
                  for (const name of toolNames) {
                    const idx = next.findIndex((s) => s.id === name);
                    if (idx >= 0) {
                      next[idx] = { ...next[idx], status: "running" as const };
                    } else {
                      next.push({
                        id: name,
                        label: TOOL_LABELS[name] || name,
                        status: "running" as const,
                      });
                    }
                  }
                  return next;
                });
                break;
              }

              case "step_done": {
                const toolName: string = data.tool;
                setSteps((prev) =>
                  prev.map((s) =>
                    s.id === toolName ? { ...s, status: "done" as const } : s,
                  ),
                );
                break;
              }

              case "info":
                onInfoUpdate(data.data);
                break;

              case "phase":
                onPhaseUpdate(data.data);
                break;

              case "plan":
                onPlanUpdate(data.markdown);
                break;

              case "tripStatus":
                onTripStatusUpdate?.(data.data);
                break;

              case "interrupt":
                assistantContent += `\n\n---\n\n*${data.message}*`;
                break;

              case "error":
                assistantContent += `\n\n错误：${data.message}`;
                break;
            }
          } catch {
            // JSON 解析失败 — 数据跨 chunk 被截断，静默跳过
          }
        }
      }

      if (allThinking && assistantContent) {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: `<think>${allThinking}</think>\n${assistantContent}`,
          };
          return updated;
        });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        // 用户主动中断，保留已接收的内容
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `连接错误：${error instanceof Error ? error.message : "未知错误"}`,
          },
        ]);
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
      scrollToBottom();
    }
  }, [threadId, scrollToBottom]);

  useImperativeHandle(ref, () => ({
    sendMessage: (text: string) => handleSubmit(text),
  }), [handleSubmit]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSubmit();
  };

  const isEmpty = messages.length === 0;
  const hasSteps = steps.length > 0;

  return (
    <div className="flex flex-col h-full relative z-[1]">
      {isEmpty ? (
        <div className="empty-state">
          <div className="empty-icon-wrap">🌏</div>
          <div className="empty-title">告诉我你的旅行想法</div>
          <div className="empty-subtitle">
            比如 &quot;我想去云南玩&quot; 或 &quot;帮我规划厦门3天游&quot;
          </div>
          <div className="suggestion-chips">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                className="suggestion-chip"
                onClick={() => handleSubmit(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="messages flex-1 overflow-y-auto p-7">
          {messages.map((msg, i) => (
            <MessageBubble
              key={i}
              role={msg.role}
              content={msg.content}
              isStreaming={
                isStreaming &&
                i === messages.length - 1 &&
                msg.role === "assistant"
              }
            />
          ))}

          {/* 进度步骤展示 */}
          {hasSteps && (
            <div className="steps-progress">
              {steps.map((step) => (
                <div
                  key={step.id}
                  className={`step-item ${step.status}`}
                >
                  <span className="step-dot" />
                  <span className="step-label">{step.label}</span>
                  {step.status === "done" && (
                    <svg
                      className="step-check"
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <path d="M2.5 7.5L5.5 10.5L11.5 3.5" />
                    </svg>
                  )}
                  {step.status === "running" && (
                    <span className="step-spinner" />
                  )}
                </div>
              ))}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      )}

      <form onSubmit={handleFormSubmit} className="input-area">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入你的旅行想法..."
          className="chat-input flex-1"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={handleStop}
            className="stop-btn"
          >
            停止
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="send-btn"
          >
            发送
          </button>
        )}
      </form>
    </div>
  );
});
