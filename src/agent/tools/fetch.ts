import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { withRetry, fetchWithTimeout } from "../../lib/fetch-utils";

const DEFAULT_TIMEOUT = 15000;
const MAX_CONTENT_LENGTH = 8000;

/**
 * Extract readable text from HTML without external dependencies.
 */
function htmlToText(html: string): string {
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "");

  text = text.replace(
    /<\/(?:div|p|h[1-6]|li|tr|article|section|header|footer|aside|nav|main)>/gi,
    "\n",
  );
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]*>/g, "");

  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x27;/g, "'")
    .replace(/&copy;/g, "©")
    .replace(/&reg;/g, "®")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));

  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

export const fetchSearch = tool(
  async ({ url }: { url: string }) => {
    const cleanUrl = url.trim();

    try {
      new URL(cleanUrl);
    } catch {
      return "错误：无效的 URL 格式，请提供完整的 URL（例如 https://example.com/page）";
    }

    try {
      const data = await withRetry(async () => {
        const res = await fetchWithTimeout(cleanUrl, DEFAULT_TIMEOUT, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; TravelAgent/1.0)",
          },
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }

        const contentType = res.headers.get("content-type") || "";
        const raw = await res.text();

        if (contentType.includes("text/html") || raw.includes("</html>")) {
          return htmlToText(raw);
        }
        return raw;
      });

      let finalContent = data;
      if (finalContent.length > MAX_CONTENT_LENGTH) {
        finalContent =
          finalContent.slice(0, MAX_CONTENT_LENGTH) +
          `\n\n…（内容已截断，原文共 ${data.length} 个字符）`;
      }

      return `页面内容（${data.length} 个字符）:\n\n${finalContent}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `获取页面失败: ${message}。请检查 URL 是否正确以及网络连接。`;
    }
  },
  {
    name: "fetch_search",
    description:
      "获取指定 URL 的网页内容并提取纯文本（截断至 8000 字）。典型用法：先用 web_search 搜索获取相关页面 URL，再用此工具抓取最相关的 1-2 个页面获取详细信息。适用于攻略详情、门票价格、开放时间等需要深入阅读的场景。",
    schema: z.object({
      url: z.string().describe("要获取内容的网页 URL，必须是完整的 https:// 格式"),
    }),
  },
);
