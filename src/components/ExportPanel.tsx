"use client";

interface ExportPanelProps {
  onExport: (format: "md" | "json") => void;
  disabled?: boolean;
}

export function ExportPanel({ onExport, disabled }: ExportPanelProps) {
  return (
    <div className="export-panel glass">
      <div className="export-title">导出行程</div>
      <div className="export-buttons">
        <button
          className="export-btn"
          onClick={() => onExport("md")}
          disabled={disabled}
        >
          Markdown
        </button>
        <button
          className="export-btn"
          onClick={() => onExport("json")}
          disabled={disabled}
        >
          JSON
        </button>
      </div>
    </div>
  );
}
