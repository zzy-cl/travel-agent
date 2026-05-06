"use client";

import { memo } from "react";

interface InfoSidebarProps {
  collectedInfo: Record<string, unknown>;
  phase: string;
}

const fields = [
  { key: "destination", label: "目的地" },
  { key: "days", label: "天数", suffix: "天" },
  { key: "people", label: "人数", suffix: "人" },
  { key: "dateRange", label: "日期" },
  { key: "budget", label: "预算" },
  { key: "preferences", label: "偏好", isArray: true },
  { key: "constraints", label: "约束", isArray: true },
];

const phaseLabels: Record<string, { text: string; cls: string }> = {
  info_gathering: { text: "信息收集中...", cls: "phase-info" },
  planning: { text: "计划生成中...", cls: "phase-planning" },
  confirming: { text: "等待确认...", cls: "phase-planning" },
  refinement: { text: "迭代优化中...", cls: "phase-refinement" },
  done: { text: "已完成", cls: "phase-done" },
};

export const InfoSidebar = memo(function InfoSidebar({ collectedInfo, phase }: InfoSidebarProps) {
  const phaseInfo = phaseLabels[phase] || phaseLabels.info_gathering;

  return (
    <div className="sidebar-inner">
      {/* 已收集信息 — 独立滚动区域 */}
      <div className="sidebar-scroll">
        <div className="sidebar-title">已收集信息</div>
        <div className="field-list">
          {fields.map(({ key, label, suffix, isArray }) => {
            let value: string;
            let hasValue: boolean;

            if (isArray) {
              const arr = collectedInfo[key];
              const items = Array.isArray(arr)
                ? arr.filter((v): v is string => typeof v === "string")
                : [];
              hasValue = items.length > 0;
              value = hasValue ? items.join("、") : "待收集";
            } else {
              const raw = collectedInfo[key];
              hasValue = raw !== undefined && raw !== null && raw !== "";
              value = hasValue ? `${raw}${suffix || ""}` : "待收集";
            }

            return (
              <div key={key} className="field-row">
                <div className={`field-check ${hasValue ? "done" : "waiting"}`}>
                  {hasValue && (
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    >
                      <path d="M3.5 8.5l3 3 6-6" />
                    </svg>
                  )}
                </div>
                <div className="field-info">
                  <div className="field-label">{label}</div>
                  <div className={`field-value ${hasValue ? "" : "pending-text"}`}>{value}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 当前阶段 — 固定在底部 */}
      <div className="sidebar-footer">
        <div className="phase-section">
          <div className="phase-title">当前阶段</div>
          <div className={`phase-badge ${phaseInfo.cls}`}>
            <span className="dot" />
            {phaseInfo.text}
          </div>
        </div>
      </div>
    </div>
  );
});
