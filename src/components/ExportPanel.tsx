"use client";

interface ExportPanelProps {
  onExport: (format: "md" | "json", includeDetails: boolean) => void;
  disabled?: boolean;
}

export function ExportPanel({ onExport, disabled }: ExportPanelProps) {
  return (
    <div className="export-panel">
      <div className="export-title">导出行程</div>
      <div className="export-buttons">
        <button
          className="export-btn"
          onClick={() => onExport("md", false)}
          disabled={disabled}
        >
          Markdown
        </button>
        <button
          className="export-btn"
          onClick={() => onExport("json", false)}
          disabled={disabled}
        >
          JSON
        </button>
      </div>
    </div>
  );
}
