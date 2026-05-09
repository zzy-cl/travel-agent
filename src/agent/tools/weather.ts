// src/agent/tools/weather.ts
// 天气查询工具 — 调用 QWeather（和风天气）API
//
// ── 调用流程 ──
// 1. 城市搜索（geoapi.qweather.com）→ 获取城市 ID
// 2. 实时天气（devapi.qweather.com/v7/weather/now）
// 3. 空气质量（devapi.qweather.com/v7/air/now）
// 4. 7 天预报（devapi.qweather.com/v7/weather/7d）
//
// ── 注意事项 ──
// - 空气质量 API 需要数字格式的城市 ID，而城市搜索可能返回字母 ID（省级单位）
//   所以优先选择数字 ID: location.find(l => /^\d+$/.test(l.id))
// - 所有外部调用都用 withRetry + fetchWithTimeout 包装，防止超时和临时故障

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { withRetry, fetchWithTimeout } from "../../lib/fetch-utils";

export const getWeather = tool(
  async ({ location, days = 1 }: { location: string; days?: number }) => {
    const apiKey = process.env.QWEATHER_API_KEY;
    if (!apiKey) return "错误：未设置 QWEATHER_API_KEY 环境变量。";

    const cleanLocation = location.trim();
    // 将天数限制在 1-7 范围内
    const effectiveDays = Math.max(1, Math.min(days ?? 1, 7));

    try {
      // Step 1: 城市搜索 → 获取城市 ID
      const searchUrl = new URL("https://geoapi.qweather.com/v2/city/lookup");
      searchUrl.searchParams.set("location", cleanLocation);
      searchUrl.searchParams.set("key", apiKey);
      searchUrl.searchParams.set("lang", "zh");

      const searchData = await withRetry(async () => {
        const res = await fetchWithTimeout(searchUrl.toString());
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as {
          code: string;
          location?: Array<{ id: string; name: string; adm1: string; country: string }>;
        };
      });

      if (searchData.code !== "200" || !searchData.location?.length) {
        return `未找到位置 "${location}"。`;
      }

      // 优先选择数字 ID（空气质量 API 要求）
      const numericLoc = searchData.location.find((l) => /^\d+$/.test(l.id));
      const loc = numericLoc ?? searchData.location[0];
      const locationId = loc.id;
      let result = `📍 ${loc.name}, ${loc.adm1}, ${loc.country}\n\n`;

      // Step 2: 实时天气
      const nowUrl = new URL("https://devapi.qweather.com/v7/weather/now");
      nowUrl.searchParams.set("location", locationId);
      nowUrl.searchParams.set("key", apiKey);

      const nowData = await withRetry(async () => {
        const res = await fetchWithTimeout(nowUrl.toString());
        return (await res.json()) as {
          code: string;
          now?: {
            text: string;
            temp: string;
            feelsLike: string;
            windDir: string;
            windScale: string;
            humidity: string;
            vis?: string;
          };
        };
      });

      if (nowData.code === "200" && nowData.now) {
        const now = nowData.now;
        result += `🌤️ 当前天气：${now.text}，${now.temp}°C（体感${now.feelsLike}°C），${now.windDir}${now.windScale}级，湿度${now.humidity}%`;
        if (now.vis) result += `，能见度${now.vis}km`;
        result += "\n\n";
      }

      // Step 3: 空气质量
      const airUrl = new URL("https://devapi.qweather.com/v7/air/now");
      airUrl.searchParams.set("location", locationId);
      airUrl.searchParams.set("key", apiKey);

      try {
        const airData = await withRetry(async () => {
          const res = await fetchWithTimeout(airUrl.toString());
          return (await res.json()) as {
            code: string;
            now?: {
              aqi: string;
              primary?: string;
              pm2p5: string;
              pm10: string;
            };
          };
        });

        if (airData.code === "200" && airData.now) {
          const air = airData.now;
          const aqiNum = parseInt(air.aqi, 10);
          const aqiLevel =
            aqiNum <= 50
              ? "优"
              : aqiNum <= 100
                ? "良"
                : aqiNum <= 150
                  ? "轻度污染"
                  : aqiNum <= 200
                    ? "中度污染"
                    : "重度污染";
          result += `💨 空气质量：AQI ${air.aqi}（${aqiLevel}），PM2.5: ${air.pm2p5}μg/m³，PM10: ${air.pm10}μg/m³`;
          if (air.primary) result += `，主要污染物: ${air.primary}`;
          result += "\n\n";
        }
      } catch {
        // 空气质量 API 不是所有地区都可用，静默忽略
      }

      // Step 4: 未来 N 天预报
      if (effectiveDays > 0) {
        const dailyUrl = new URL("https://devapi.qweather.com/v7/weather/7d");
        dailyUrl.searchParams.set("location", locationId);
        dailyUrl.searchParams.set("key", apiKey);

        const dailyData = await withRetry(async () => {
          const res = await fetchWithTimeout(dailyUrl.toString());
          return (await res.json()) as {
            code: string;
            daily?: Array<{
              fxDate: string;
              textDay: string;
              textNight: string;
              tempMin: string;
              tempMax: string;
              uvIndex?: string;
            }>;
          };
        });

        if (dailyData.code === "200" && dailyData.daily) {
          const forecastDays = dailyData.daily.slice(0, effectiveDays);
          result += `📅 未来${forecastDays.length}天预报：\n`;
          for (const day of forecastDays) {
            result += `  ${day.fxDate}: ${day.textDay}/${day.textNight}，${day.tempMin}°C~${day.tempMax}°C`;
            if (day.uvIndex) {
              const uv = parseInt(day.uvIndex, 10);
              const uvLevel = uv <= 2 ? "弱" : uv <= 5 ? "中等" : uv <= 7 ? "强" : "很强";
              result += `，紫外线${uvLevel}`;
            }
            result += "\n";
          }
        }
      }

      const finalResult = result.trim();
      return finalResult;
    } catch (error) {
      return `获取天气失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "get_weather",
    description:
      "获取指定地区当前天气、空气质量（AQI/PM2.5）和未来多天预报（含紫外线指数）。用于规划行程时了解目的地天气状况，据此安排室内外活动。",
    schema: z.object({
      location: z.string().describe("城市名，如 北京、深圳"),
      days: z.number().min(1).optional().default(1).describe("预报天数（自动限制在 1-7 范围内）"),
    }),
  },
);
