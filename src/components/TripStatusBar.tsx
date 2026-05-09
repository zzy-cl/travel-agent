// src/components/TripStatusBar.tsx
// 旅行状态指示器 — 显示当前旅行的状态和目的地
//
// 三种状态:
// - planning（规划中）: 蓝色
// - ongoing（旅行中）: 绿色
// - completed（已完成）: 灰色
//
// ── suppressHydrationWarning ──
// SSR 时 destination 可能为空（服务端没有 localStorage 数据），
// 客户端水合后才有值。suppressHydrationWarning 防止 React 报 hydration mismatch 警告。

"use client";

type TripStatus = "planning" | "ongoing" | "completed";

interface TripStatusBarProps {
  status: TripStatus;
  destination?: string;
}

const statusConfig: Record<TripStatus, { label: string; color: string }> = {
  planning: { label: "规划中", color: "#3b82f6" },
  ongoing: { label: "旅行中", color: "#10b981" },
  completed: { label: "已完成", color: "#6b7280" },
};

export function TripStatusBar({ status, destination }: TripStatusBarProps) {
  const config = statusConfig[status];

  return (
    <div className="trip-status-bar">
      <div className="trip-status-dot" style={{ background: config.color }} />
      <span className="trip-status-label">{config.label}</span>
      <span className="trip-status-dest" suppressHydrationWarning>
        {destination ? `· ${destination}` : ""}
      </span>
    </div>
  );
}
