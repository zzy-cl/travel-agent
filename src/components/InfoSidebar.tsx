// src/components/InfoSidebar.tsx
// 信息侧边栏组件 — 展示已收集的旅行信息和当前阶段
//
// 这个组件是"只读"的 —— 它只展示数据，不修改数据。
// 数据来自 ChatPanel 的 SSE 事件 → page.tsx 的 state → 通过 props 传入。
//
// ── 展示结构 ──
// 1. 核心信息: 目的地、天数、人数、日期、预算
// 2. 动态亮点: highlights 数组中的 label-value 对
// 3. 其他信息: 交通、住宿、偏好、约束
// 4. 当前阶段: info_gathering / planning / confirming / done
//
// ── memo 优化 ──
// 使用 React.memo 包装，避免父组件 re-render 时不必要的更新。
// 只有 collectedInfo 或 phase 变化时才重新渲染。

"use client";

import { memo } from "react";

interface InfoSidebarProps {
  collectedInfo: Record<string, unknown>;
  phase: string;
}

interface Highlight {
  label: string;
  value: string;
}

/** 核心固定字段 */
const coreFields = [
  { key: "destination", label: "目的地" },
  { key: "days", label: "天数", suffix: "天" },
  { key: "people", label: "人数", suffix: "人" },
  { key: "dateRange", label: "日期" },
  { key: "budget", label: "预算" },
];

/** 辅助固定字段 */
const extraFields: Array<{
  key: string;
  label: string;
  suffix?: string;
  isArray?: boolean;
}> = [
  { key: "transport", label: "交通方式" },
  { key: "accommodation", label: "住宿偏好" },
  { key: "preferences", label: "偏好", isArray: true },
  { key: "constraints", label: "约束", isArray: true },
];

/** 阶段 → 中文标签 + CSS 类名 */
const phaseLabels: Record<string, { text: string; cls: string }> = {
  info_gathering: { text: "信息收集中...", cls: "phase-info" },
  planning: { text: "计划生成中...", cls: "phase-planning" },
  confirming: { text: "等待确认...", cls: "phase-planning" },
  refinement: { text: "迭代优化中...", cls: "phase-refinement" },
  done: { text: "已完成", cls: "phase-done" },
};

/** 安全提取 highlights 数组（类型守卫） */
function getHighlights(raw: unknown): Highlight[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (h): h is Highlight =>
      typeof h === "object" &&
      h !== null &&
      typeof (h as Highlight).label === "string" &&
      typeof (h as Highlight).value === "string",
  );
}

/** 单个字段行: 标签 + 值 + 状态指示点 */
function FieldRow({
  label,
  value,
  hasValue,
  variant = "default",
}: {
  label: string;
  value: string;
  hasValue: boolean;
  variant?: "default" | "highlight";
}) {
  const dotClass =
    variant === "highlight"
      ? hasValue
        ? "field-check highlight-done"
        : "field-check highlight-waiting"
      : hasValue
        ? "field-check done"
        : "field-check waiting";

  const checker = hasValue ? (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <path d="M3.5 8.5l3 3 6-6" />
    </svg>
  ) : null;

  return (
    <div className="field-row">
      <div className={dotClass}>{checker}</div>
      <div className="field-info">
        <div className="field-label">{label}</div>
        <div className={`field-value ${hasValue ? "" : "pending-text"}`}>{value}</div>
      </div>
    </div>
  );
}

export const InfoSidebar = memo(function InfoSidebar({ collectedInfo, phase }: InfoSidebarProps) {
  const phaseInfo = phaseLabels[phase] || phaseLabels.info_gathering;
  const highlights = getHighlights(collectedInfo.highlights);

  return (
    <div className="sidebar-inner">
      <div className="sidebar-scroll">
        {/* ── 核心信息 ── */}
        <div className="sidebar-title">📌 核心信息</div>
        <div className="field-list">
          {coreFields.map(({ key, label, suffix }) => {
            const raw = collectedInfo[key];
            const hasValue = raw !== undefined && raw !== null && raw !== "";
            const value = hasValue ? `${raw}${suffix || ""}` : "待收集";
            return <FieldRow key={key} label={label} value={value} hasValue={hasValue} />;
          })}
        </div>

        {/* ── 动态亮点 ── */}
        {highlights.length > 0 && (
          <>
            <div className="sidebar-title" style={{ marginTop: 20 }}>
              ✨ 亮点
            </div>
            <div className="field-list">
              {highlights.map((hl, i) => (
                <FieldRow
                  key={`hl-${i}`}
                  label={hl.label}
                  value={hl.value}
                  hasValue={true}
                  variant="highlight"
                />
              ))}
            </div>
          </>
        )}

        {/* ── 其他信息 ── */}
        <div className="sidebar-title" style={{ marginTop: 20 }}>
          📋 其他
        </div>
        <div className="field-list">
          {extraFields.map(({ key, label, suffix, isArray }) => {
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

            return <FieldRow key={key} label={label} value={value} hasValue={hasValue} />;
          })}
        </div>
      </div>

      {/* 当前阶段 */}
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
