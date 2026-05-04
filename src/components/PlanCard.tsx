"use client";

interface PlanCardProps {
  markdown: string;
  onSave?: () => void;
  onRetry?: () => void;
}

export function PlanCard({ markdown, onSave, onRetry }: PlanCardProps) {
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
      <div className="bg-gradient-to-r from-blue-500 to-purple-500 px-4 py-3">
        <h3 className="text-white font-semibold">旅行计划</h3>
      </div>

      <div className="p-4 max-h-96 overflow-y-auto">
        <div className="prose prose-sm max-w-none whitespace-pre-wrap text-gray-700">
          {markdown}
        </div>
      </div>

      <div className="border-t border-gray-100 p-3 flex gap-2 justify-end">
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            重新生成
          </button>
        )}
        {onSave && (
          <button
            onClick={onSave}
            className="px-4 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
          >
            满意，保存
          </button>
        )}
      </div>
    </div>
  );
}
