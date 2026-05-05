import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { fetchWithTimeout, withRetry } from "../../lib/fetch-utils";

async function geocode(address: string, apiKey: string): Promise<string | null> {
  const url = `https://restapi.amap.com/v3/geocode/geo?address=${encodeURIComponent(address)}&key=${apiKey}`;
  try {
    const res = await withRetry(() => fetchWithTimeout(url));
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status === "1" && data.geocodes?.[0]?.location) {
      return data.geocodes[0].location; // "lng,lat"
    }
  } catch {
    // Fall through
  }
  return null;
}

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
      // Geocode all points first
      const allNames = [startPoint, ...attractions, startPoint];
      const coords: (string | null)[] = await Promise.all(
        allNames.map((name) => geocode(name, apiKey))
      );

      // Check for geocoding failures
      const failedNames = allNames.filter((_, i) => !coords[i]);
      if (failedNames.length > 0) {
        return `无法定位以下地点：${[...new Set(failedNames)].join("、")}。请尝试使用更具体的名称或坐标。`;
      }

      const allPoints = coords as string[];
      const results: string[] = [];
      let accumulatedMinutes = 0;

      for (let i = 0; i < allPoints.length - 1; i++) {
        const origin = allPoints[i];
        const destination = allPoints[i + 1];
        const originName = allNames[i];
        const destName = allNames[i + 1];

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
            `${originName} → ${destName}：路线查询失败（HTTP ${res.status}）`
          );
          continue;
        }
        const data = await res.json();

        if (data.status === "1" && data.route) {
          let duration: string;
          let distance: string;
          let routeMinutes = 0;

          if (mode === "walking") {
            const path = data.route.paths?.[0];
            routeMinutes = path ? Math.round(parseInt(path.duration, 10) / 60) : 0;
            duration = path ? `${routeMinutes}分钟` : "未知";
            distance = path
              ? `${(parseInt(path.distance, 10) / 1000).toFixed(1)}公里`
              : "未知";
          } else if (mode === "transit") {
            const transit = data.route.transits?.[0];
            routeMinutes = transit ? Math.round(parseInt(transit.duration, 10) / 60) : 0;
            duration = transit ? `${routeMinutes}分钟` : "未知";
            distance = transit
              ? `${(parseInt(transit.distance, 10) / 1000).toFixed(1)}公里`
              : "未知";
          } else {
            const path = data.route.paths?.[0];
            routeMinutes = path ? Math.round(parseInt(path.duration, 10) / 60) : 0;
            duration = path ? `${routeMinutes}分钟` : "未知";
            distance = path
              ? `${(parseInt(path.distance, 10) / 1000).toFixed(1)}公里`
              : "未知";
          }

          accumulatedMinutes += routeMinutes;

          results.push(
            `${originName} → ${destName}：${distance}，约${duration}`
          );
        } else {
          results.push(`${originName} → ${destName}：路线查询失败`);
        }
      }

      let summary = `## 路线规划（${transport === "walk" ? "步行" : transport === "drive" ? "驾车" : "公共交通"}）\n\n`;
      summary += results.join("\n");

      if (timeConstraint && accumulatedMinutes > timeConstraint) {
        summary += `\n\n⚠️ 总耗时约${accumulatedMinutes}分钟，超出${timeConstraint}分钟的约束。建议减少景点或选择更快的交通方式。`;
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
