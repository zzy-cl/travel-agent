"use client";

import { useState, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex, rehypeHighlight];

interface PlanCardProps {
  markdown: string;
  onSave?: () => void;
  onRetry?: () => void;
}

export const PlanCard = memo(function PlanCard({ markdown, onSave, onRetry }: PlanCardProps) {
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
        {onRetry && (
          <button className="plan-btn plan-btn-ghost" onClick={onRetry}>
            重新生成
          </button>
        )}
        {onSave && (
          <button className="plan-btn plan-btn-primary" onClick={onSave}>
            满意，保存
          </button>
        )}
      </div>
    </div>
  );
});
