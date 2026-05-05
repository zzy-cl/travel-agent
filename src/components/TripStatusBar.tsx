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
      {destination && <span className="trip-status-dest">· {destination}</span>}
    </div>
  );
}
