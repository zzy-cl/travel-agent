// src/app/page.tsx
// 主页面 — 应用的顶层组件，编排所有子组件
//
// ── 组件结构 ──
//
//   page.tsx（状态管理 + 布局编排）
//   ├── ChatPanel（聊天面板 — 用户交互 + SSE 流式通信）
//   ├── InfoSidebar（侧边栏 — 展示已收集信息）
//   ├── PlanCard（计划卡片 — 展示生成的旅行计划）
//   └── TripStatusBar（状态指示器）
//
// ── 状态提升（Lifting State Up）──
// collectedInfo、phase、planMarkdown 等状态定义在 page.tsx 中，
// 而不是各自的组件中。这是因为多个组件需要共享这些数据:
// - ChatPanel 通过 SSE 事件更新这些状态
// - InfoSidebar 和 PlanCard 读取这些状态来渲染 UI
//
// ── 数据流 ──
//
//   用户输入 → ChatPanel → POST /api/chat → SSE 流
//   → onInfoUpdate / onPhaseUpdate / onPlanUpdate 回调
//   → page.tsx setState
//   → props 传给 InfoSidebar / PlanCard → UI 更新
//
// ── 移动端适配 ──
// - 桌面: 左侧 ChatPanel + 右侧 InfoSidebar（始终可见）
// - 移动: ChatPanel 全屏，InfoSidebar 通过滑动手势/按钮触发滑入

"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ChatPanel, type ChatPanelHandle } from "@/components/ChatPanel";
import { InfoSidebar } from "@/components/InfoSidebar";
import { PlanCard } from "@/components/PlanCard";
import { TripStatusBar } from "@/components/TripStatusBar";

export default function Home() {
  // ── 共享状态（由 ChatPanel 更新，由 InfoSidebar/PlanCard 读取）──
  const [collectedInfo, setCollectedInfo] = useState<Record<string, unknown>>({
    preferences: [],
    constraints: [],
    highlights: [],
  });
  const [phase, setPhase] = useState<string>("info_gathering");
  const [planMarkdown, setPlanMarkdown] = useState<string | null>(null);
  const [tripStatus, setTripStatus] = useState<"planning" | "ongoing" | "completed">("planning");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ref: 用于调用 ChatPanel 的 sendMessage 方法（"补充修改"按钮）
  const chatPanelRef = useRef<ChatPanelHandle>(null);

  // SSE 事件回调（传给 ChatPanel）
  const handleInfoUpdate = useCallback((info: Record<string, unknown>) => {
    setCollectedInfo((prev) => {
      // 避免相同引用触发不必要的 re-render
      if (JSON.stringify(prev) === JSON.stringify(info)) return prev;
      return info as typeof prev;
    });
  }, []);
  const handlePhaseUpdate = useCallback((p: string) => setPhase(p), []);
  const handlePlanUpdate = useCallback((md: string | null) => setPlanMarkdown(md), []);

  const handleTripStatusUpdate = useCallback(
    (s: string) => setTripStatus(s as "planning" | "ongoing" | "completed"),
    [],
  );

  // ── 移动端侧边栏手势（右滑关闭）──
  const touchStartX = useRef(0);
  const handleSidebarTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);
  const handleSidebarTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.changedTouches[0].clientX - touchStartX.current > 60) {
      setSidebarOpen(false);
    }
  }, []);

  // ── 侧边栏快捷键（Escape 关闭）──
  const sidebarCloseRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!sidebarOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    document.addEventListener("keydown", handleEscape);
    sidebarCloseRef.current?.focus();
    return () => document.removeEventListener("keydown", handleEscape);
  }, [sidebarOpen]);

  // ── PlanCard 回调 ──

  /** 保存计划: 生成 .md 文件并触发下载 */
  const handlePlanSave = useCallback(() => {
    const blob = new Blob([planMarkdown ?? ""], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `travel-plan-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [planMarkdown]);

  /** 修改计划: 清空计划，回到信息收集阶段，自动发送补充消息 */
  const handlePlanModify = useCallback(() => {
    setPlanMarkdown(null);
    setPhase("info_gathering");
    chatPanelRef.current?.sendMessage("我想补充或修改一些旅行信息");
  }, []);

  return (
    <>
      {/* 背景装饰层 */}
      <div className="bg-canvas" />

      <div className="shell-responsive relative z-[1] flex h-screen flex-col gap-3 p-3">
        {/* ── Header ── */}
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
            {/* TripStatusBar — 桌面端可见 */}
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
            {/* 移动端侧边栏触发按钮 */}
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
            {/* 模型标识徽章 */}
            <span className="hidden rounded-[var(--radius-pill)] border border-[rgba(0,122,255,0.15)] bg-[rgba(0,122,255,0.12)] px-3.5 py-1.5 text-[11px] font-semibold tracking-[0.02em] text-[#007AFF] md:inline">
              <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-[pulseLive_2s_infinite] rounded-full bg-[var(--success)] shadow-[0_0_6px_rgba(48,209,88,0.50)]" />
              MiMo
            </span>
          </div>
        </header>

        {/* ── 主内容区 ── */}
        <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
          {/* 聊天面板 */}
          <div className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-xl)]">
            <ChatPanel
              ref={chatPanelRef}
              onInfoUpdate={handleInfoUpdate}
              onPhaseUpdate={handlePhaseUpdate}
              onPlanUpdate={handlePlanUpdate}
              onTripStatusUpdate={handleTripStatusUpdate}
            />
          </div>

          {/* 桌面端侧边栏 — 始终可见 */}
          <aside className="sidebar glass glass-light hidden md:flex">
            <InfoSidebar collectedInfo={collectedInfo} phase={phase} />
          </aside>
        </div>
      </div>

      {/* ── 移动端侧边栏覆盖层 ── */}
      <div
        className={`fixed inset-0 z-[100] transition-opacity duration-300 md:hidden ${
          sidebarOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onTouchStart={handleSidebarTouchStart}
        onTouchEnd={handleSidebarTouchEnd}
      >
        {/* 半透明遮罩（点击关闭） */}
        <div
          className="absolute inset-0 bg-black/20 backdrop-blur-[4px]"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
        {/* 滑入面板 */}
        <div
          role="dialog"
          aria-modal="true"
          aria-label="已收集信息"
          className={`absolute top-0 right-0 bottom-0 flex w-[300px] max-w-[85vw] flex-col overflow-hidden rounded-l-[var(--radius-xl)] border border-r-0 border-[var(--glass-edge)] bg-[var(--glass-h)] saturate-[220%] backdrop-blur-[80px] transition-transform duration-[400ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${
            sidebarOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="bg-[linear-gradient(165deg,rgba(255,255,255,0.30)_0%,rgba(255,255,255,0.05)_25%,transparent 50%)] pointer-events-none absolute inset-0 z-0 rounded-[inherit]" />
          <div className="pointer-events-none absolute inset-0 z-0 rounded-[inherit] shadow-[inset_0_1px_0_rgba(255,255,255,0.50),inset_0_-1px_0_rgba(255,255,255,0.08)]" />

          <div className="relative z-[1] flex items-center justify-between border-b border-white/15 px-5 py-4">
            <span className="text-[15px] font-bold text-[var(--text-primary)]">已收集信息</span>
            <button
              ref={sidebarCloseRef}
              className="flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-full border border-white/30 bg-white/12 text-lg text-[var(--text-secondary)]"
              onClick={() => setSidebarOpen(false)}
              aria-label="关闭侧边栏"
            >
              &times;
            </button>
          </div>
          <div className="relative z-[1] flex min-h-0 flex-1 flex-col px-5 py-[18px]">
            <InfoSidebar collectedInfo={collectedInfo} phase={phase} />
          </div>
        </div>
      </div>

      {/* 旅行计划卡片（有计划时渲染） */}
      {planMarkdown && (
        <PlanCard markdown={planMarkdown} onSave={handlePlanSave} onModify={handlePlanModify} />
      )}
    </>
  );
}
