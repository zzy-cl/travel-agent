"use client";

import { useState } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { InfoSidebar } from "@/components/InfoSidebar";
import { PlanCard } from "@/components/PlanCard";

export default function Home() {
  const [collectedInfo, setCollectedInfo] = useState<Record<string, unknown>>({
    preferences: [],
    constraints: [],
  });
  const [phase, setPhase] = useState("info_gathering");
  const [planMarkdown, setPlanMarkdown] = useState<string | null>(null);

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Header */}
      <header className="border-b border-gray-200 px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900">
          智能旅游规划助手
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          告诉我你的旅行想法，我来帮你规划
        </p>
      </header>

      {/* Main */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat Area */}
        <div className="flex-1 flex flex-col">
          <ChatPanel
            onInfoUpdate={(info) =>
              setCollectedInfo((prev) => ({ ...prev, ...info }))
            }
            onPhaseUpdate={setPhase}
            onPlanUpdate={setPlanMarkdown}
          />
        </div>

        {/* Sidebar */}
        <div className="w-72 border-l border-gray-200">
          <InfoSidebar collectedInfo={collectedInfo} phase={phase} />
        </div>
      </div>

      {/* Plan Card Overlay */}
      {planMarkdown && (
        <div className="fixed bottom-4 right-4 w-96 z-50">
          <PlanCard
            markdown={planMarkdown}
            onSave={() => {
              // 下载 Markdown
              const blob = new Blob([planMarkdown], { type: "text/markdown" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `travel-plan-${new Date().toISOString().slice(0, 10)}.md`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            onRetry={() => setPlanMarkdown(null)}
          />
        </div>
      )}
    </div>
  );
}
