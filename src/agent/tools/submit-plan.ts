import { tool } from "@langchain/core/tools";
import { travelPlanSchema, type TravelPlan } from "../../schemas/travel-plan";

function formatActivities(
  activities: TravelPlan["dailyPlans"][number]["activities"],
): string {
  if (!activities.length) return "";
  let table =
    "| 时间 | 活动 | 地点 | 耗时 | 备注 |\n|------|------|------|------|------|\n";
  for (const a of activities) {
    table += `| ${a.time || "-"} | ${a.activity} | ${a.location} | ${a.duration || "-"} | ${a.notes || "-"} |\n`;
  }
  return table;
}

function formatMeals(meals: TravelPlan["dailyPlans"][number]["meals"]): string {
  const labels: Record<string, string> = {
    breakfast: "早餐",
    lunch: "午餐",
    dinner: "晚餐",
    snack: "小吃",
  };
  return meals
    .map(
      (m) =>
        `  - ${labels[m.type] || m.type}: ${m.recommendation}${m.estimatedCost ? ` (约${m.estimatedCost})` : ""}`,
    )
    .join("\n");
}

function renderMarkdown(plan: TravelPlan): string {
  let md = `# ${plan.destination} 旅游攻略\n\n`;
  md += `## 目的地概览\n\n${plan.overview}\n\n`;
  if (plan.bestSeason) md += `**最佳旅游季节**：${plan.bestSeason}\n\n`;

  md += `## 住宿推荐\n\n`;
  md += `- **推荐区域**：${plan.accommodation.area}\n`;
  md += `- **住宿建议**：${plan.accommodation.recommendation}\n`;
  md += `- **预算**：${plan.accommodation.estimatedCost}\n\n`;

  md += `## 交通建议\n\n`;
  md += `- **到达方式**：${plan.transportation.howToGetThere}\n`;
  md += `- **当地交通**：${plan.transportation.localTransport}\n\n`;

  md += `## 每日行程\n\n`;
  for (const day of plan.dailyPlans) {
    md += `### 第${day.day}天：${day.title}\n\n`;
    md += formatActivities(day.activities);
    md += `\n**美食推荐**：\n${formatMeals(day.meals)}\n\n`;
  }

  md += `## 特色美食\n\n`;
  for (const food of plan.foodRecommendations) md += `- ${food}\n`;

  md += `\n## 预算估算\n\n**总计**：${plan.budget.total}\n\n`;
  md += `| 项目 | 费用 |\n|------|------|\n`;
  for (const item of plan.budget.breakdown)
    md += `| ${item.category} | ${item.cost} |\n`;

  md += `\n## ⚠️ 注意事项\n\n`;
  for (const w of plan.warnings) md += `- ${w}\n`;

  return md;
}

export const submitPlan = tool(
  async (plan) => {
    return renderMarkdown(plan as TravelPlan);
  },
  {
    name: "submit_plan",
    description:
      "提交最终的旅游计划。只有用户明确确认后才调用，调用一次后不再修改。",
    schema: travelPlanSchema,
  },
);
