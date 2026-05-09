// src/components/ChatPanel.tsx
// 聊天面板组件 — 应用的核心交互区域
//
// 这个组件处理所有聊天相关的逻辑:
// 1. 用户输入 → POST /api/chat → SSE 流式接收
// 2. 解析 SSE 事件 → 更新消息列表、工具进度、侧边栏
// 3. 展示中断确认卡片（info_collector 完成后）
//
// ── SSE 流式接收机制 ──
// 浏览器通过 fetch() 发起请求，拿到 ReadableStream:
//
//   const response = await fetch("/api/chat", { method: "POST", body: ... });
//   const reader = response.body.getReader();
//   while (true) {
//     const { done, value } = await reader.read();
//     // value 是 Uint8Array，需要 TextDecoder 解码
//   }
//
// 数据格式: "data: {JSON}\n\n"
// 可能跨 chunk（一条 JSON 被分到两个 chunk），所以用 buffer 缓存处理。
//
// ── forwardRef + useImperativeHandle ──
// 父组件（page.tsx）需要调用 ChatPanel 的 sendMessage 方法（如"补充修改"按钮）。
// React 中子组件不能直接暴露方法，需要:
// 1. forwardRef: 让父组件可以传 ref 给子组件
// 2. useImperativeHandle: 定义 ref 暴露哪些方法
//
// ── 事件类型分发 ──
// SSE 事件有 12 种类型，每种对应不同的 UI 更新:
// thinking/token/replace → 消息文本
// step/step_done → 工具进度条
// info → 侧边栏
// phase/tripStatus → 状态指示器
// plan → 计划卡片
// interrupt → 确认卡片

"use client";

import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from "react";
import { MessageBubble } from "./MessageBubble";

interface InterruptData {
  message: string;
  type: "info_confirm";
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

/** 工具执行进度条中的单个步骤 */
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

// 快捷建议（空状态时展示）
const SUGGESTIONS = ["🌸 我想去云南玩5天", "🏝️ 厦门3天亲子游", "🍜 成都美食之旅", "🏔️ 川西自驾7天"];

// 工具名称 → 中文标签的映射
const TOOL_LABELS: Record<string, string> = {
  get_weather: "查询目的地天气",
  web_search: "搜索最新旅游资讯",
  fetch_search: "获取网页详细内容",
  search_attractions: "搜索城市景点",
  search_nearby: "搜索周边酒店餐厅",
  update_collected_info: "记录旅行信息",
  confirm_info: "确认信息完整",
  submit_plan: "正在生成旅行计划...",
  get_attraction_detail: "查询景点详细信息",
};

export const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(function ChatPanel(
  { onInfoUpdate, onPhaseUpdate, onPlanUpdate, onTripStatusUpdate },
  ref,
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [steps, setSteps] = useState<StepItem[]>([]);
  const [interruptData, setInterruptData] = useState<InterruptData | null>(null);
  const [threadId] = useState(() => crypto.randomUUID());
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
  }, [messages, steps, interruptData, scrollToBottom]);

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  /**
   * 核心: 发送消息并处理 SSE 流式响应。
   *
   * 流程:
   * 1. 发送 POST /api/chat
   * 2. 拿到 ReadableStream，逐块读取
   * 3. 按 "\n" 分割，解析 "data: {JSON}" 行
   * 4. 根据事件类型分发处理
   */
  const handleSubmit = useCallback(
    async (text?: string) => {
      const userMessage = (text || inputRef.current).trim();
      if (!userMessage) return;
      if (isStreamingRef.current && !interruptData) return;

      // 如果正在流式输出时用户确认，先中断当前流
      if (isStreamingRef.current) {
        abortControllerRef.current?.abort();
      }
      setInterruptData(null);

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

        // 添加空的 assistant 消息占位，后续逐步填充
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

        // buffer: 处理跨 chunk 的 JSON（一条 SSE 消息可能被分到两个 chunk）
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // 流结束: 处理 buffer 中剩余的数据
            if (buffer.trim()) {
              const remaining = buffer.split("\n");
              for (const line of remaining) {
                if (!line.startsWith("data: ")) continue;
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.type === "info") onInfoUpdate(data.data);
                  else if (data.type === "phase") onPhaseUpdate(data.data);
                  else if (data.type === "plan") onPlanUpdate(data.markdown);
                  else if (data.type === "tripStatus") onTripStatusUpdate?.(data.data);
                } catch {
                  // 最后一条可能不完整，静默跳过
                }
              }
            }
            break;
          }

          // 将新数据追加到 buffer
          buffer += decoder.decode(value, { stream: true });

          // 按 "\n" 分割，最后一行可能不完整，放回 buffer
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          // 逐行解析 SSE 事件
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));

              // 更新消息文本的辅助函数
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

              // 根据事件类型分发处理
              switch (data.type) {
                case "thinking":
                  allThinking += data.content;
                  updateMessage();
                  break;

                case "token":
                  assistantContent += data.content;
                  updateMessage();
                  break;

                case "replace":
                  // 节点完成后用干净文本替换流式文本（可能去掉了 JSON）
                  assistantContent = data.content;
                  updateMessage();
                  break;

                case "step": {
                  // 工具开始执行 → 添加到进度条
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
                  // 工具执行完成 → 标记 ✓
                  const toolName: string = data.tool;
                  setSteps((prev) =>
                    prev.map((s) => (s.id === toolName ? { ...s, status: "done" as const } : s)),
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

                case "interrupt": {
                  // 信息确认中断 → 显示确认卡片
                  setInterruptData({
                    message: data.message,
                    type: "info_confirm",
                  });
                  break;
                }

                case "error":
                  assistantContent += `\n\n错误：${data.message}`;
                  break;
              }
            } catch {
              // JSON 解析失败 — 数据跨 chunk 被截断，静默跳过
            }
          }
        }

        // 最终更新消息（处理 thinking + text 的组合显示）
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
    },
    [
      threadId,
      scrollToBottom,
      onInfoUpdate,
      onPhaseUpdate,
      onPlanUpdate,
      onTripStatusUpdate,
      interruptData,
    ],
  );

  // 暴露 sendMessage 方法给父组件（用于"补充修改"等按钮）
  useImperativeHandle(
    ref,
    () => ({
      sendMessage: (text: string) => handleSubmit(text),
    }),
    [handleSubmit],
  );

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSubmit();
  };

  const handleConfirm = useCallback(
    (message: string) => {
      setInterruptData(null);
      handleSubmit(message);
    },
    [handleSubmit],
  );

  const handleDismissInterrupt = useCallback(() => {
    setInterruptData(null);
  }, []);

  const isEmpty = messages.length === 0;
  const hasSteps = steps.length > 0;

  return (
    <div className="relative z-[1] flex h-full flex-col">
      {isEmpty ? (
        // 空状态: 展示欢迎语和快捷建议
        <div className="empty-state">
          <div className="empty-icon-wrap">🌏</div>
          <div className="empty-title">告诉我你的旅行想法</div>
          <div className="empty-subtitle">
            比如 &quot;我想去云南玩&quot; 或 &quot;帮我规划厦门3天游&quot;
          </div>
          <div className="suggestion-chips">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="suggestion-chip" onClick={() => handleSubmit(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        // 消息列表
        <div className="messages flex-1 overflow-y-auto p-7">
          {messages.map((msg, i) => (
            <MessageBubble
              key={i}
              role={msg.role}
              content={msg.content}
              isStreaming={isStreaming && i === messages.length - 1 && msg.role === "assistant"}
            />
          ))}

          {/* 工具执行进度条 */}
          {hasSteps && (
            <div className="steps-progress">
              {steps.map((step) => (
                <div key={step.id} className={`step-item ${step.status}`}>
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
                  {step.status === "running" && <span className="step-spinner" />}
                </div>
              ))}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      )}

      {/* 中断确认卡片 — info_collector 完成后展示，让用户确认或补充 */}
      {interruptData && (
        <div className="confirm-card">
          <div className="confirm-card-content">
            {interruptData.message.split("\n").map((line, i) => (
              <p key={i} className={line ? "" : "confirm-card-empty-line"}>
                {line}
              </p>
            ))}
          </div>
          <div className="confirm-card-actions">
            <button className="confirm-btn confirm-btn-ghost" onClick={handleDismissInterrupt}>
              继续收集
            </button>
            <button
              className="confirm-btn confirm-btn-primary"
              onClick={() => handleConfirm("确认")}
            >
              生成计划
            </button>
          </div>
        </div>
      )}

      {/* 输入区域 */}
      <form onSubmit={handleFormSubmit} className="input-area">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入你的旅行想法..."
          className="chat-input flex-1"
        />
        {isStreaming ? (
          <button type="button" onClick={handleStop} className="stop-btn">
            停止
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()} className="send-btn">
            发送
          </button>
        )}
      </form>
    </div>
  );
});
