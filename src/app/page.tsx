"use client";

import { useState, useCallback, useRef } from "react";
import { ChatPanel, type ChatPanelHandle } from "@/components/ChatPanel";
import { InfoSidebar } from "@/components/InfoSidebar";
import { PlanCard } from "@/components/PlanCard";
import { MapPanel } from "@/components/MapPanel";
import { ExportPanel } from "@/components/ExportPanel";
import { TripStatusBar } from "@/components/TripStatusBar";

export default function Home() {
  const [collectedInfo, setCollectedInfo] = useState<Record<string, unknown>>({
    preferences: [],
    constraints: [],
  });
  const [phase, setPhase] = useState("info_gathering");
  const [planMarkdown, setPlanMarkdown] = useState<string | null>(null);
  const [tripStatus, setTripStatus] = useState<"planning" | "ongoing" | "completed">("planning");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const chatPanelRef = useRef<ChatPanelHandle>(null);

  const handleMapReorder = useCallback(
    (from: { day: number; index: number }, to: { day: number; index: number }, name: string) => {
      if (from.day === to.day && from.index === to.index) return;

      const message = `[系统] 用户调整了行程：将「${name}」从第${from.day}天第${from.index + 1}个位置移到第${to.day}天第${to.index + 1}个位置，请重新规划路线。`;

      // Send as a user message
      chatPanelRef.current?.sendMessage(message);
    },
    [],
  );

  // Swipe-to-close on mobile sidebar overlay
  const touchStartX = useRef(0);
  const handleSidebarTouchStart = useCallback(
    (e: React.TouchEvent) => {
      touchStartX.current = e.touches[0].clientX;
    },
    [],
  );
  const handleSidebarTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (e.changedTouches[0].clientX - touchStartX.current > 60) {
        setSidebarOpen(false);
      }
    },
    [],
  );

  return (
    <>
      <div className="bg-canvas" />

      <div className="shell-responsive flex flex-col h-screen relative z-[1] p-3 gap-3">
        {/* Header */}
        <header className="glass glass-heavy rounded-[var(--radius-l)] px-6 py-3.5 flex items-center justify-between flex-shrink-0 z-10">
          <div className="flex items-center gap-3.5 relative z-[1]">
            <div className="w-[42px] h-[42px] rounded-[14px] bg-gradient-to-br from-[#007AFF] via-[#5AC8FA] to-[#64D2FF] flex items-center justify-center text-white text-[22px] shadow-[0_4px_16px_rgba(0,122,255,0.30),inset_0_1px_0_rgba(255,255,255,0.30)] relative overflow-hidden">
              <span className="relative z-[1]">&#9992;</span>
              <div className="absolute inset-0 rounded-[inherit] bg-[linear-gradient(165deg,rgba(255,255,255,0.35)_0%,transparent_60%)] animate-[iconShimmer_4s_ease-in-out_infinite]" />
            </div>
            <div>
              <div className="text-[17px] font-bold text-[var(--text-primary)] tracking-[-0.03em]">
                智能旅游规划助手
              </div>
              <div className="text-[13px] text-[var(--text-secondary)] mt-px font-normal">
                告诉我你的旅行想法，我来帮你规划
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 relative z-[1]">
            <TripStatusBar
              status={tripStatus}
              destination={typeof collectedInfo.destination === "string" ? collectedInfo.destination : undefined}
            />
            {/* Mobile sidebar toggle — CSS 媒体查询控制显示 */}
            <button
              className="md:hidden w-9 h-9 rounded-[12px] border border-white/35 bg-white/15 backdrop-blur-[20px] text-[var(--text-secondary)] flex items-center justify-center text-lg cursor-pointer transition-all active:bg-white/30 active:scale-95 relative overflow-hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="查看已收集信息"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <path d="M3 5h14M3 10h10M3 15h14" />
              </svg>
              <div className="absolute inset-0 rounded-[inherit] bg-[linear-gradient(165deg,rgba(255,255,255,0.25)_0%,transparent_50%)]" />
            </button>
            <span className="hidden md:inline text-[11px] font-semibold px-3.5 py-1.5 rounded-[var(--radius-pill)] bg-[rgba(0,122,255,0.12)] text-[#007AFF] border border-[rgba(0,122,255,0.15)] tracking-[0.02em]">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--success)] mr-1.5 shadow-[0_0_6px_rgba(48,209,88,0.50)] animate-[pulseLive_2s_infinite]" />
              DeepSeek
            </span>
          </div>
        </header>

        {/* Main area */}
        <div className="flex-1 flex gap-3 overflow-hidden min-h-0">
          {/* Chat + Map column */}
          <div className="flex-1 flex flex-col gap-3 min-w-0">
            {/* Chat Panel */}
            <div className="flex-1 flex flex-col glass rounded-[var(--radius-xl)] overflow-hidden min-h-0">
              <ChatPanel
                ref={chatPanelRef}
                onInfoUpdate={(info) =>
                  setCollectedInfo((prev) => ({ ...prev, ...info }))
                }
                onPhaseUpdate={setPhase}
                onPlanUpdate={setPlanMarkdown}
                onTripStatusUpdate={(s) => setTripStatus(s as "planning" | "ongoing" | "completed")}
              />
            </div>

            {/* Map Panel — only visible when plan contains attractions */}
            {planMarkdown && (
              <MapPanel attractions={[]} onReorder={handleMapReorder} />
            )}

            {/* Export Panel */}
            <ExportPanel
              onExport={(format: "md" | "json") => {
                if (!planMarkdown) return;
                let content: string;
                let ext: string;
                let mimeType: string;
                if (format === "json") {
                  content = JSON.stringify({
                    format: "travel-plan",
                    version: "1.0",
                    exportedAt: new Date().toISOString(),
                    collectedInfo,
                    planMarkdown,
                  }, null, 2);
                  ext = "json";
                  mimeType = "application/json";
                } else {
                  content = planMarkdown;
                  ext = "md";
                  mimeType = "text/markdown";
                }
                const blob = new Blob([content], { type: mimeType });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `travel-plan-${new Date().toISOString().slice(0, 10)}.${ext}`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              disabled={!planMarkdown}
            />
          </div>

          {/* Desktop Sidebar — CSS 媒体查询控制显示 */}
          <aside className="sidebar glass glass-light hidden md:flex">
            <InfoSidebar collectedInfo={collectedInfo} phase={phase} />
          </aside>
        </div>
      </div>

      {/* Mobile Sidebar Overlay — CSS 媒体查询 + JS 状态控制滑入 */}
      <div
        className={`md:hidden fixed inset-0 z-[100] transition-opacity duration-300 ${
          sidebarOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        onTouchStart={handleSidebarTouchStart}
        onTouchEnd={handleSidebarTouchEnd}
      >
        <div
          className="absolute inset-0 bg-black/20 backdrop-blur-[4px]"
          onClick={() => setSidebarOpen(false)}
        />
        <div
          className={`absolute top-0 right-0 bottom-0 w-[300px] max-w-[85vw] transition-transform duration-[400ms] ease-[cubic-bezier(0.32,0.72,0,1)] flex flex-col rounded-l-[var(--radius-xl)] bg-[var(--glass-h)] backdrop-blur-[blur(80px)_saturate(220%)] border border-[var(--glass-edge)] border-r-0 overflow-hidden ${
            sidebarOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="absolute inset-0 rounded-[inherit] bg-[linear-gradient(165deg,rgba(255,255,255,0.30)_0%,rgba(255,255,255,0.05)_25%,transparent_50%)] pointer-events-none z-0" />
          <div className="absolute inset-0 rounded-[inherit] shadow-[inset_0_1px_0_rgba(255,255,255,0.50),inset_0_-1px_0_rgba(255,255,255,0.08)] pointer-events-none z-0" />

          <div className="px-5 py-4 flex items-center justify-between border-b border-white/15 relative z-[1]">
            <span className="text-[15px] font-bold text-[var(--text-primary)]">
              已收集信息
            </span>
            <button
              className="w-[30px] h-[30px] rounded-full border border-white/30 bg-white/12 text-[var(--text-secondary)] flex items-center justify-center text-lg cursor-pointer"
              onClick={() => setSidebarOpen(false)}
            >
              &times;
            </button>
          </div>
          <div className="flex-1 flex flex-col min-h-0 px-5 py-[18px] relative z-[1]">
            <InfoSidebar collectedInfo={collectedInfo} phase={phase} />
          </div>
        </div>
      </div>

      {planMarkdown && (
        <PlanCard
          markdown={planMarkdown}
          onSave={() => {
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
      )}
    </>
  );
}
