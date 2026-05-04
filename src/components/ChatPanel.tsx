"use client";

import { useState, useRef, useCallback } from "react";
import { MessageBubble } from "./MessageBubble";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatPanelProps {
  onInfoUpdate: (info: Record<string, unknown>) => void;
  onPhaseUpdate: (phase: string) => void;
  onPlanUpdate: (markdown: string) => void;
}

export function ChatPanel({
  onInfoUpdate,
  onPhaseUpdate,
  onPlanUpdate,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [threadId] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("travel-thread-id");
      if (stored) return stored;
      const id = crypto.randomUUID();
      localStorage.setItem("travel-thread-id", id);
      return id;
    }
    return crypto.randomUUID();
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsStreaming(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage, threadId }),
      });

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let assistantContent = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));

            switch (data.type) {
              case "token":
                assistantContent += data.content;
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    role: "assistant",
                    content: assistantContent,
                  };
                  return updated;
                });
                break;
              case "info":
                onInfoUpdate(data.data);
                break;
              case "phase":
                onPhaseUpdate(data.data);
                break;
              case "plan":
                onPlanUpdate(data.markdown);
                break;
              case "interrupt":
                // interrupt 状态，等待用户输入
                break;
              case "error":
                assistantContent += `\n\n错误：${data.message}`;
                break;
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `连接错误：${error instanceof Error ? error.message : "未知错误"}`,
        },
      ]);
    } finally {
      setIsStreaming(false);
      scrollToBottom();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-20">
            <p className="text-lg">告诉我你的旅行想法</p>
            <p className="text-sm mt-2">
              比如 "我想去云南玩" 或 "帮我规划厦门3天游"
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} role={msg.role} content={msg.content} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-gray-200 p-4 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入你的旅行想法..."
          className="flex-1 rounded-full border border-gray-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={isStreaming}
        />
        <button
          type="submit"
          disabled={isStreaming || !input.trim()}
          className="rounded-full bg-blue-600 px-6 py-2 text-sm text-white font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors"
        >
          {isStreaming ? "..." : "发送"}
        </button>
      </form>
    </div>
  );
}
