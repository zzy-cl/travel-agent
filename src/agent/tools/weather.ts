// src/agent/tools/weather.ts
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { weatherCache } from "../../lib/cache";
import { withRetry, fetchWithTimeout } from "../../lib/fetch-utils";

export const getWeather = tool(
  async ({ location, days = 1 }: { location: string; days?: number }) => {
    const apiKey = process.env.QWEATHER_API_KEY;
    if (!apiKey) return "错误：未设置 QWEATHER_API_KEY 环境变量。";

    const cleanLocation = location.trim();
    const cacheKey = `${cleanLocation}:${days}`;
    const cached = weatherCache.get(cacheKey);
    if (cached !== null) return `(缓存命中)\n${cached}`;

    try {
      // Step 1: City lookup
      const searchUrl = new URL("https://geoapi.qweather.com/v2/city/lookup");
      searchUrl.searchParams.set("location", cleanLocation);
      searchUrl.searchParams.set("key", apiKey);
      searchUrl.searchParams.set("lang", "zh");

      const searchData = await withRetry(async () => {
        const res = await fetchWithTimeout(searchUrl.toString());
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as {
          code: string;
          location?: Array<{
            id: string;
            name: string;
            adm1: string;
            country: string;
          }>;
        };
      });

      if (searchData.code !== "200" || !searchData.location?.length) {
        return `未找到位置 "${location}"。`;
      }

      const loc = searchData.location[0];
      const locationId = loc.id;
      let result = `📍 ${loc.name}, ${loc.adm1}, ${loc.country}\n\n`;

      // Step 2: Current weather
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
          };
        };
      });

      if (nowData.code === "200" && nowData.now) {
        const now = nowData.now;
        result += `🌤️ 当前天气：${now.text}，${now.temp}°C（体感${now.feelsLike}°C），${now.windDir}${now.windScale}级，湿度${now.humidity}%\n\n`;
      }

      // Step 3: Forecast
      if (days > 0) {
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
            }>;
          };
        });

        if (dailyData.code === "200" && dailyData.daily) {
          const forecastDays = dailyData.daily.slice(0, Math.min(days, 7));
          result += `📅 未来${forecastDays.length}天预报：\n`;
          for (const day of forecastDays) {
            result += `  ${day.fxDate}: ${day.textDay}/${day.textNight}，${day.tempMin}°C~${day.tempMax}°C\n`;
          }
        }
      }

      const finalResult = result.trim();
      weatherCache.set(cacheKey, finalResult);
      return finalResult;
    } catch (error) {
      return `获取天气失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "get_weather",
    description: "获取指定地区当前天气和未来多天预报。",
    schema: z.object({
      location: z.string().describe("城市名，如 北京、深圳"),
      days: z.number().min(1).max(7).optional().default(1).describe("预报天数"),
    }),
  },
);
