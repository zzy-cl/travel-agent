"use client";

interface PlanCardProps {
  markdown: string;
  onSave?: () => void;
  onRetry?: () => void;
}

export function PlanCard({ markdown, onSave, onRetry }: PlanCardProps) {
  return (
    <div className="plan-card">
      <div className="plan-header">
        <div className="plan-header-left">
          <div className="plan-header-icon">📋</div>
          <div className="plan-header-title">旅行计划</div>
        </div>
        {onRetry && (
          <button className="plan-close" onClick={onRetry}>
            &times;
          </button>
        )}
      </div>
      <div className="plan-body">{markdown}</div>
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
}
