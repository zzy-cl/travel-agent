import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { db } from "../../lib/db";

const preferencesSchema = z.object({
  userId: z.string().describe("用户ID"),
  likes: z.array(z.string()).optional().describe("喜欢的旅行类型，如：自然、人文、美食"),
  dislikes: z.array(z.string()).optional().describe("不喜欢的类型，如：购物、拥挤景点"),
  dietary: z.string().optional().describe("饮食偏好：素食、清真、无限制"),
  mobility: z.enum(["high", "medium", "low"]).optional().describe("步行耐受度"),
  budget: z.enum(["economy", "moderate", "luxury"]).optional().describe("预算等级"),
  travelStyle: z.enum(["packed", "relaxed"]).optional().describe("行程紧凑度"),
});

export const savePreferences = tool(
  async ({ userId, ...preferences }: z.infer<typeof preferencesSchema>) => {
    try {
      const existing = await db.user.findUnique({ where: { id: userId } });
      let currentPrefs: Record<string, unknown> = {};
      if (existing?.preferences) {
        try {
          currentPrefs = JSON.parse(existing.preferences);
        } catch {
          // Invalid JSON in DB, start fresh
        }
      }
      const merged = { ...currentPrefs, ...preferences };

      if (existing) {
        await db.user.update({
          where: { id: userId },
          data: { preferences: JSON.stringify(merged) },
        });
      } else {
        await db.user.create({
          data: {
            id: userId,
            preferences: JSON.stringify(merged),
          },
        });
      }

      return `偏好已保存：${JSON.stringify(merged)}`;
    } catch (e) {
      return `偏好保存失败：${e instanceof Error ? e.message : "请稍后重试"}`;
    }
  },
  {
    name: "save_preferences",
    description: "保存用户的旅行偏好，包括喜欢/不喜欢的类型、饮食偏好、步行耐受度、预算等级、行程紧凑度。",
    schema: preferencesSchema,
  },
);

export const loadPreferences = tool(
  async ({ userId }: { userId: string }) => {
    try {
      const user = await db.user.findUnique({ where: { id: userId } });
      if (!user) return "暂无已保存的偏好";
      return `用户偏好：${user.preferences}`;
    } catch (e) {
      return `偏好加载失败：${e instanceof Error ? e.message : ""}`;
    }
  },
  {
    name: "load_preferences",
    description: "加载用户的旅行偏好",
    schema: z.object({
      userId: z.string().describe("用户ID"),
    }),
  },
);
