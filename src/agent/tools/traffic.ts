import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { fetchWithTimeout, withRetry } from "../../lib/fetch-utils";

export const getTraffic = tool(
  async ({ origin, destination }: { origin: string; destination: string }) => {
    const apiKey = process.env.AMAP_API_KEY;
    if (!apiKey) return "交通查询暂不可用（API Key 未配置）";

    try {
      const url = `https://restapi.amap.com/v3/direction/driving?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&key=${apiKey}&extensions=traffic`;
      const res = await withRetry(() => fetchWithTimeout(url));
      if (!res.ok) return `交通查询失败（HTTP ${res.status}）`;
      const data = await res.json();

      if (data.status !== "1" || !data.route?.paths?.[0]) {
        return `无法查询从${origin}到${destination}的交通状况`;
      }

      const path = data.route.paths[0];
      const distance = (parseInt(path.distance, 10) / 1000).toFixed(1);
      const duration = Math.round(parseInt(path.duration, 10) / 60);
      const trafficLights = path.traffic_lights || "未知";

      return `从${origin}到${destination}：距离${distance}公里，预计${duration}分钟，途经${trafficLights}个红绿灯。${path.tolls ? `过路费约${path.tolls}元。` : ""}`;
    } catch (e) {
      return `交通查询失败：${e instanceof Error ? e.message : "请稍后重试"}`;
    }
  },
  {
    name: "get_traffic",
    description: "查询两个地点之间的实时交通状况，包括距离、预计耗时、红绿灯数量。用于行程规划中的路线时间估算。",
    schema: z.object({
      origin: z.string().describe("起点名称或坐标"),
      destination: z.string().describe("终点名称或坐标"),
    }),
  },
);
