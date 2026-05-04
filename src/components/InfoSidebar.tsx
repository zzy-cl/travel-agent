"use client";

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
];

export function InfoSidebar({ collectedInfo, phase }: InfoSidebarProps) {
  const phaseLabels: Record<string, { text: string; color: string }> = {
    info_gathering: { text: "信息收集中...", color: "text-blue-500" },
    planning: { text: "计划生成中...", color: "text-yellow-500" },
    refinement: { text: "迭代优化中...", color: "text-purple-500" },
    done: { text: "已完成", color: "text-green-500" },
  };

  const phaseInfo = phaseLabels[phase] || phaseLabels.info_gathering;

  return (
    <div className="h-full bg-gray-50 p-4 overflow-y-auto">
      <h3 className="font-semibold text-gray-800 mb-4">已收集信息</h3>

      <div className="space-y-2 text-sm">
        {fields.map(({ key, label, suffix }) => {
          const value = collectedInfo[key];
          const hasValue = value !== undefined && value !== null && value !== "";
          return (
            <div key={key} className="flex items-center gap-2">
              <span className={hasValue ? "text-green-500" : "text-yellow-500"}>
                {hasValue ? "✓" : "○"}
              </span>
              <span className="text-gray-600">{label}：</span>
              <span className={hasValue ? "text-gray-900" : "text-gray-400"}>
                {hasValue
                  ? `${value}${suffix || ""}`
                  : "待收集"}
              </span>
            </div>
          );
        })}

        {/* 偏好 */}
        <div className="flex items-start gap-2">
          <span
            className={
              (collectedInfo.preferences as string[])?.length
                ? "text-green-500"
                : "text-yellow-500"
            }
          >
            {(collectedInfo.preferences as string[])?.length ? "✓" : "○"}
          </span>
          <span className="text-gray-600">偏好：</span>
          <span className="text-gray-400">
            {(collectedInfo.preferences as string[])?.length
              ? (collectedInfo.preferences as string[]).join("、")
              : "待收集"}
          </span>
        </div>

        {/* 约束 */}
        <div className="flex items-start gap-2">
          <span
            className={
              (collectedInfo.constraints as string[])?.length
                ? "text-green-500"
                : "text-yellow-500"
            }
          >
            {(collectedInfo.constraints as string[])?.length ? "✓" : "○"}
          </span>
          <span className="text-gray-600">约束：</span>
          <span className="text-gray-400">
            {(collectedInfo.constraints as string[])?.length
              ? (collectedInfo.constraints as string[]).join("、")
              : "待收集"}
          </span>
        </div>
      </div>

      <div className="mt-6 pt-4 border-t border-gray-200">
        <h3 className="font-semibold text-gray-800 mb-2">当前阶段</h3>
        <div className={`text-sm font-medium ${phaseInfo.color}`}>
          {phaseInfo.text}
        </div>
      </div>
    </div>
  );
}
