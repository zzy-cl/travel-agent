// src/agent/tools/fetch.ts
// 网页内容抓取工具 — 获取 URL 页面的纯文本内容
//
// ── 工作流程 ──
// 1. 验证 URL 格式
// 2. 发起 HTTP 请求（15s 超时）
// 3. 如果是 HTML 页面 → 提取纯文本（去 script/style 标签，HTML 实体解码）
// 4. 截断到 8000 字符（防止超长页面消耗过多 token）
//
// ── htmlToText — 纯正则实现 ──
// 为了减少依赖，HTML→text 转换完全用正则实现（不依赖 cheerio/jsdom）。
// 策略: 先删 script/style/head，再把块标签转为换行，最后去所有标签。

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { withRetry, fetchWithTimeout } from "../../lib/fetch-utils";

const DEFAULT_TIMEOUT = 15000; // 15 秒（网页抓取通常比 API 调用慢）
const MAX_CONTENT_LENGTH = 8000; // 最大返回字符数

/**
 * 用正则将 HTML 转为纯文本。
 *
 * 处理步骤:
 * 1. 删除不可见内容: <script>、<style>、<noscript>、<head>
 * 2. 块标签转换行: </div>、</p>、<h1>-<h6>、</li> 等 → \n
 * 3. 删除所有剩余标签: <...>
 * 4. 解码 HTML 实体: &amp; → &、&lt; → <、&#123; → { 等
 * 5. 合并多余空白
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

    // URL 格式验证
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

        // HTML 页面 → 提取纯文本；其他类型（如 JSON）→ 直接返回
        if (contentType.includes("text/html") || raw.includes("</html>")) {
          return htmlToText(raw);
        }
        return raw;
      });

      // 截断超长内容，附带原始长度提示
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
