import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { fetchWithTimeout, withRetry } from "../../lib/fetch-utils";

const optimizeRouteSchema = z.object({
  attractions: z.array(z.string()).describe("景点名称列表"),
  startPoint: z.string().describe("出发点（如酒店名称或地址）"),
  transport: z
    .enum(["walk", "drive", "transit"])
    .describe("交通方式：walk=步行，drive=驾车，transit=公共交通"),
  timeConstraint: z
    .number()
    .optional()
    .describe("时间约束（分钟），可选"),
});

export const optimizeRoute = tool(
  async ({ attractions, startPoint, transport, timeConstraint }) => {
    const apiKey = process.env.AMAP_API_KEY;
    if (!apiKey) return "路线优化暂不可用（API Key 未配置）";

    if (attractions.length === 0) return "没有景点可供规划路线";

    try {
      const allPoints = [startPoint, ...attractions, startPoint];
      const results: string[] = [];

      for (let i = 0; i < allPoints.length - 1; i++) {
        const origin = allPoints[i];
        const destination = allPoints[i + 1];

        const modeMap: Record<string, string> = {
          walk: "walking",
          drive: "driving",
          transit: "transit",
        };
        const mode = modeMap[transport] || "driving";

        const url = `https://restapi.amap.com/v3/direction/${mode}?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&key=${apiKey}`;
        const res = await withRetry(() => fetchWithTimeout(url));
        if (!res.ok) {
          results.push(
            `${origin} → ${destination}：路线查询失败（HTTP ${res.status}）`
          );
          continue;
        }
        const data = await res.json();

        if (data.status === "1" && data.route) {
          let duration: string;
          let distance: string;

          if (mode === "walking") {
            const path = data.route.paths?.[0];
            duration = path
              ? `${Math.round(parseInt(path.duration, 10) / 60)}分钟`
              : "未知";
            distance = path
              ? `${(parseInt(path.distance, 10) / 1000).toFixed(1)}公里`
              : "未知";
          } else if (mode === "transit") {
            duration = data.route.transits?.[0]
              ? `${Math.round(parseInt(data.route.transits[0].duration, 10) / 60)}分钟`
              : "未知";
            distance = data.route.transits?.[0]
              ? `${(parseInt(data.route.transits[0].distance, 10) / 1000).toFixed(1)}公里`
              : "未知";
          } else {
            const path = data.route.paths?.[0];
            duration = path
              ? `${Math.round(parseInt(path.duration, 10) / 60)}分钟`
              : "未知";
            distance = path
              ? `${(parseInt(path.distance, 10) / 1000).toFixed(1)}公里`
              : "未知";
          }

          results.push(
            `${origin} → ${destination}：${distance}，约${duration}`
          );
        } else {
          results.push(`${origin} → ${destination}：路线查询失败`);
        }
      }

      let summary = `## 路线规划（${transport === "walk" ? "步行" : transport === "drive" ? "驾车" : "公共交通"}）\n\n`;
      summary += results.join("\n");

      if (timeConstraint) {
        const totalMinutes = results.reduce((sum, r) => {
          const match = r.match(/约(\d+)分钟/);
          return sum + (match ? parseInt(match[1], 10) : 0);
        }, 0);
        if (totalMinutes > timeConstraint) {
          summary += `\n\n⚠️ 总耗时约${totalMinutes}分钟，超出${timeConstraint}分钟的约束。建议减少景点或选择更快的交通方式。`;
        }
      }

      return summary;
    } catch (e) {
      return `路线优化失败：${e instanceof Error ? e.message : "请稍后重试"}`;
    }
  },
  {
    name: "optimize_route",
    description:
      "优化多个景点之间的路线，计算每段距离和预计耗时。支持步行、驾车、公共交通三种方式。可设置时间约束来判断行程是否可行。",
    schema: optimizeRouteSchema,
  }
);
