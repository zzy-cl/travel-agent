import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const exportJson = tool(
  ({ planMarkdown, collectedInfo }: { planMarkdown: string; collectedInfo?: string }) => {
    if (!planMarkdown) return "没有可导出的行程";

    let parsedInfo: unknown = null;
    if (collectedInfo) {
      try {
        parsedInfo = JSON.parse(collectedInfo);
      } catch {
        parsedInfo = { raw: collectedInfo };
      }
    }

    const result = {
      format: "travel-plan",
      version: "1.0",
      exportedAt: new Date().toISOString(),
      collectedInfo: parsedInfo,
      planMarkdown,
      days: extractDaysFromMarkdown(planMarkdown),
    };

    return JSON.stringify(result, null, 2);
  },
  {
    name: "export_json",
    description: "将旅行计划导出为结构化 JSON 格式",
    schema: z.object({
      planMarkdown: z.string().describe("行程的 Markdown 内容"),
      collectedInfo: z.string().optional().describe("收集的信息 JSON 字符串"),
    }),
  },
);

function extractDaysFromMarkdown(markdown: string): Array<{ day: number; title: string; items: string[] }> {
  const days: Array<{ day: number; title: string; items: string[] }> = [];
  const dayRegex = /(?:^|\n)#+\s*(?:第(\d+)[天日]|Day\s*(\d+))\s*[:：]?\s*(.*)/gi;
  let match;

  while ((match = dayRegex.exec(markdown)) !== null) {
    const dayNum = parseInt(match[1] || match[2], 10);
    const title = match[3]?.trim() || `第${dayNum}天`;

    const afterHeading = markdown.slice(match.index + match[0].length);
    const nextHeading = afterHeading.search(/\n#+\s/);
    const section = nextHeading >= 0 ? afterHeading.slice(0, nextHeading) : afterHeading;
    const items = section
      .split("\n")
      .map((line) => line.replace(/^[\s\-\*]+/, "").trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    days.push({ day: dayNum, title, items });
  }

  return days;
}
