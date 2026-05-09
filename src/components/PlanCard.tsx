// src/components/PlanCard.tsx
// 旅行计划卡片组件 — 全屏覆盖展示生成的旅行计划
//
// ── 功能 ──
// 1. Markdown 渲染: 将 plan_agent 生成的 Markdown 渲染为格式化内容
// 2. 折叠/展开: 可以最小化为底部条
// 3. 操作按钮: "补充修改"（回到信息收集）和"点击保存"（下载 .md 文件）
//
// ── 触发时机 ──
// 当 phase 变为 "confirming" 且 planMarkdown 不为空时，page.tsx 渲染此组件。

"use client";

import { useState, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeSanitize, rehypeKatex, rehypeHighlight];

interface PlanCardProps {
  markdown: string;
  onSave?: () => void;
  onModify?: () => void;
}

export const PlanCard = memo(function PlanCard({ markdown, onSave, onModify }: PlanCardProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <div className="plan-card plan-card-collapsed">
        <button className="plan-collapsed-bar" onClick={() => setCollapsed(false)}>
          <span
            className="plan-header-icon"
            style={{ width: 24, height: 24, borderRadius: 8, fontSize: 12 }}
          >
            &#128203;
          </span>
          <span className="plan-header-title">旅行计划</span>
          <span className="plan-collapsed-hint">点击展开</span>
        </button>
      </div>
    );
  }

  return (
    <div className="plan-card">
      <div className="plan-header">
        <div className="plan-header-left">
          <div className="plan-header-icon">&#128203;</div>
          <div className="plan-header-title">旅行计划</div>
        </div>
        <button className="plan-close" onClick={() => setCollapsed(true)}>
          &times;
        </button>
      </div>
      <div className="plan-body">
        <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
          {markdown}
        </ReactMarkdown>
      </div>
      <div className="plan-footer">
        {onModify && (
          <button className="plan-btn plan-btn-ghost" onClick={onModify}>
            补充修改
          </button>
        )}
        {onSave && (
          <button className="plan-btn plan-btn-primary" onClick={onSave}>
            点击保存
          </button>
        )}
      </div>
    </div>
  );
});
