import { z } from "zod";

export const dailyActivitySchema = z.object({
  time: z.string().optional().describe("活动时间，如 09:00"),
  activity: z.string().describe("活动名称"),
  location: z.string().describe("活动地点"),
  duration: z.string().optional().describe("预计耗时，如 2小时"),
  notes: z.string().optional().describe("备注，如需要预约"),
});

export const dailyMealSchema = z.object({
  type: z.enum(["breakfast", "lunch", "dinner", "snack"]).describe("餐食类型"),
  recommendation: z.string().describe("推荐菜品或餐厅"),
  estimatedCost: z.string().optional().describe("预估人均花费"),
});

export const dailyPlanSchema = z.object({
  day: z.number().describe("第几天"),
  title: z.string().describe("当天主题"),
  activities: z.array(dailyActivitySchema).describe("当天活动列表"),
  meals: z.array(dailyMealSchema).describe("当天美食推荐"),
});

export const travelPlanSchema = z.object({
  destination: z.string().describe("目的地"),
  overview: z.string().describe("目的地简要介绍"),
  bestSeason: z.string().optional().describe("最佳旅游季节"),
  accommodation: z.object({
    area: z.string().describe("推荐住宿区域"),
    recommendation: z.string().describe("住宿建议"),
    estimatedCost: z.string().describe("住宿预算"),
  }),
  transportation: z.object({
    howToGetThere: z.string().describe("如何到达目的地"),
    localTransport: z.string().describe("当地交通建议"),
  }),
  dailyPlans: z.array(dailyPlanSchema).describe("每日行程"),
  foodRecommendations: z.array(z.string()).describe("当地特色美食推荐"),
  budget: z.object({
    total: z.string().describe("总预算估算"),
    breakdown: z
      .array(z.object({ category: z.string(), cost: z.string() }))
      .describe("各项费用明细"),
  }),
  warnings: z.array(z.string()).describe("注意事项"),
});

export type TravelPlan = z.infer<typeof travelPlanSchema>;
