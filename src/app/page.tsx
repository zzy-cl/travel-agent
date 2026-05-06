"use client";

import { useState, useCallback, useRef, useEffect, useSyncExternalStore } from "react";
import { ChatPanel, type ChatPanelHandle } from "@/components/ChatPanel";
import { InfoSidebar } from "@/components/InfoSidebar";
import { PlanCard } from "@/components/PlanCard";
import { TripStatusBar } from "@/components/TripStatusBar";

const SESSION_KEY = "travel-agent-session";

interface SessionData {
  collectedInfo: Record<string, unknown>;
  phase: string;
  planMarkdown: string | null;
  tripStatus: string;
}

function getSession(): SessionData | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

// SSR-safe localStorage subscription via useSyncExternalStore
const subscribe = (callback: () => void) => {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
};
const useSession = () => useSyncExternalStore(subscribe, getSession, () => null);

export default function Home() {
  const session = useSession();
  const defaults = {
    collectedInfo: { preferences: [], constraints: [] } as Record<string, unknown>,
    phase: "info_gathering" as const,
    planMarkdown: null as string | null,
    tripStatus: "planning" as const,
  };

  const [collectedInfo, setCollectedInfo] = useState<Record<string, unknown>>(
    session?.collectedInfo ?? defaults.collectedInfo,
  );
  const [phase, setPhase] = useState(session?.phase ?? defaults.phase);
  const [planMarkdown, setPlanMarkdown] = useState<string | null>(
    session?.planMarkdown ?? defaults.planMarkdown,
  );
  const [tripStatus, setTripStatus] = useState<"planning" | "ongoing" | "completed">(
    (session?.tripStatus as "planning" | "ongoing" | "completed") ?? defaults.tripStatus,
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Cross-tab sync: update state when localStorage changes in another tab
  useEffect(() => {
    if (!session) return;
    // Defer setState to avoid react-hooks/set-state-in-effect lint error
    const id = requestAnimationFrame(() => {
      setCollectedInfo((prev) => {
        if (JSON.stringify(prev) === JSON.stringify(session.collectedInfo)) return prev;
        return session.collectedInfo ?? defaults.collectedInfo;
      });
      setPhase((prev) => (prev === session.phase ? prev : (session.phase ?? defaults.phase)));
      setPlanMarkdown((prev) =>
        prev === session.planMarkdown ? prev : (session.planMarkdown ?? defaults.planMarkdown),
      );
      setTripStatus((prev) => {
        const next =
          (session.tripStatus as "planning" | "ongoing" | "completed") ?? defaults.tripStatus;
        return prev === next ? prev : next;
      });
    });
    return () => cancelAnimationFrame(id);
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps -- session is the only changing dependency

  // Restore message for ChatPanel
  const restoreMessage = (() => {
    if (!session) return undefined;
    if (session.planMarkdown && session.phase === "confirming") {
      return "已恢复上次的旅行计划。请查看上方内容，说'没问题'保存，或告诉我修改意见。";
    }
    if (session.phase === "planning" && session.collectedInfo.destination) {
      const dest = session.collectedInfo.destination;
      const days = session.collectedInfo.days;
      return `已恢复之前的旅行信息（${dest}${days ? `，${days}天` : ""}）。请继续描述你的需求，或说"确认"开始生成计划。`;
    }
    return undefined;
  })();

  // Persist to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ collectedInfo, phase, planMarkdown, tripStatus }),
      );
    } catch {
      // localStorage full or unavailable
    }
  }, [collectedInfo, phase, planMarkdown, tripStatus]);

  const chatPanelRef = useRef<ChatPanelHandle>(null);

  const handleTripStatusUpdate = useCallback(
    (s: string) => setTripStatus(s as "planning" | "ongoing" | "completed"),
    [],
  );

  // Swipe-to-close on mobile sidebar overlay
  const touchStartX = useRef(0);
  const handleSidebarTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);
  const handleSidebarTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.changedTouches[0].clientX - touchStartX.current > 60) {
      setSidebarOpen(false);
    }
  }, []);

  return (
    <>
      <div className="bg-canvas" />

      <div className="shell-responsive relative z-[1] flex h-screen flex-col gap-3 p-3">
        {/* Header */}
        <header className="glass glass-heavy z-10 flex flex-shrink-0 items-center justify-between rounded-[var(--radius-l)] px-6 py-3.5">
          <div className="relative z-[1] flex items-center gap-3.5">
            <div className="relative flex h-[42px] w-[42px] items-center justify-center overflow-hidden rounded-[14px] bg-gradient-to-br from-[#007AFF] via-[#5AC8FA] to-[#64D2FF] text-[22px] text-white shadow-[0_4px_16px_rgba(0,122,255,0.30),inset_0_1px_0_rgba(255,255,255,0.30)]">
              <span className="relative z-[1]">&#9992;</span>
              <div className="absolute inset-0 animate-[iconShimmer_4s_ease-in-out_infinite] rounded-[inherit] bg-[linear-gradient(165deg,rgba(255,255,255,0.35)_0%,transparent_60%)]" />
            </div>
            <div>
              <div className="text-[17px] font-bold tracking-[-0.03em] text-[var(--text-primary)]">
                智能旅游规划助手
              </div>
              <div className="mt-px text-[13px] font-normal text-[var(--text-secondary)]">
                告诉我你的旅行想法，我来帮你规划
              </div>
            </div>
          </div>
          <div className="relative z-[1] flex items-center gap-2">
            {/* TripStatusBar — desktop only */}
            <span className="hidden md:inline" suppressHydrationWarning>
              <TripStatusBar
                status={tripStatus}
                destination={
                  typeof collectedInfo.destination === "string"
                    ? collectedInfo.destination
                    : undefined
                }
              />
            </span>
            {/* Mobile sidebar toggle — CSS 媒体查询控制显示 */}
            <button
              className="relative flex h-9 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-[12px] border border-white/35 bg-white/15 text-lg text-[var(--text-secondary)] backdrop-blur-[20px] transition-all active:scale-95 active:bg-white/30 md:hidden"
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
            <span className="hidden rounded-[var(--radius-pill)] border border-[rgba(0,122,255,0.15)] bg-[rgba(0,122,255,0.12)] px-3.5 py-1.5 text-[11px] font-semibold tracking-[0.02em] text-[#007AFF] md:inline">
              <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-[pulseLive_2s_infinite] rounded-full bg-[var(--success)] shadow-[0_0_6px_rgba(48,209,88,0.50)]" />
              DeepSeek
            </span>
          </div>
        </header>

        {/* Main area */}
        <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
          {/* Chat Panel */}
          <div className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-xl)]">
            <ChatPanel
              ref={chatPanelRef}
              restoreMessage={restoreMessage}
              onInfoUpdate={(info) => setCollectedInfo((prev) => ({ ...prev, ...info }))}
              onPhaseUpdate={setPhase}
              onPlanUpdate={setPlanMarkdown}
              onTripStatusUpdate={handleTripStatusUpdate}
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
        className={`fixed inset-0 z-[100] transition-opacity duration-300 md:hidden ${
          sidebarOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onTouchStart={handleSidebarTouchStart}
        onTouchEnd={handleSidebarTouchEnd}
      >
        <div
          className="absolute inset-0 bg-black/20 backdrop-blur-[4px]"
          onClick={() => setSidebarOpen(false)}
        />
        <div
          className={`absolute top-0 right-0 bottom-0 flex w-[300px] max-w-[85vw] flex-col overflow-hidden rounded-l-[var(--radius-xl)] border border-r-0 border-[var(--glass-edge)] bg-[var(--glass-h)] backdrop-blur-[blur(80px)_saturate(220%)] transition-transform duration-[400ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${
            sidebarOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="pointer-events-none absolute inset-0 z-0 rounded-[inherit] bg-[linear-gradient(165deg,rgba(255,255,255,0.30)_0%,rgba(255,255,255,0.05)_25%,transparent_50%)]" />
          <div className="pointer-events-none absolute inset-0 z-0 rounded-[inherit] shadow-[inset_0_1px_0_rgba(255,255,255,0.50),inset_0_-1px_0_rgba(255,255,255,0.08)]" />

          <div className="relative z-[1] flex items-center justify-between border-b border-white/15 px-5 py-4">
            <span className="text-[15px] font-bold text-[var(--text-primary)]">已收集信息</span>
            <button
              className="flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-full border border-white/30 bg-white/12 text-lg text-[var(--text-secondary)]"
              onClick={() => setSidebarOpen(false)}
            >
              &times;
            </button>
          </div>
          <div className="relative z-[1] flex min-h-0 flex-1 flex-col px-5 py-[18px]">
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
          onRetry={() => {
            setPlanMarkdown(null);
            setPhase("planning");
            chatPanelRef.current?.sendMessage("帮我重新规划旅行计划");
          }}
        />
      )}
    </>
  );
}
