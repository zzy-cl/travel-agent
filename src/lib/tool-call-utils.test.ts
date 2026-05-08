import { describe, it, expect } from "vitest";
import { extractAndCleanText } from "./tool-call-utils";

describe("extractAndCleanText", () => {
  it("returns plain text unchanged", () => {
    const { textCalls, cleanText } = extractAndCleanText("Hello, I can help you plan a trip.");
    expect(textCalls).toHaveLength(0);
    expect(cleanText).toBe("Hello, I can help you plan a trip.");
  });

  it("strips trailing update_collected_info JSON", () => {
    const raw = '好的！我来帮你规划。\n{"destination":"云南","days":5,"people":2}';
    const { textCalls, cleanText } = extractAndCleanText(raw);
    expect(textCalls).toHaveLength(1);
    expect(textCalls[0].name).toBe("update_collected_info");
    expect(textCalls[0].args).toEqual({ destination: "云南", days: 5, people: 2 });
    expect(cleanText).not.toContain("destination");
    expect(cleanText).toContain("好的");
  });

  it("strips trailing confirm_info JSON (empty object)", () => {
    const raw = "信息已收集完毕。{}";
    const { textCalls, cleanText } = extractAndCleanText(raw);
    expect(textCalls).toHaveLength(1);
    expect(textCalls[0].name).toBe("confirm_info");
    expect(cleanText).not.toContain("{}");
  });

  it("does not strip JSON with unrecognized keys", () => {
    const raw = 'Result: {"foo":"bar","baz":1}';
    const { textCalls, cleanText } = extractAndCleanText(raw);
    expect(textCalls).toHaveLength(0);
    expect(cleanText).toBe(raw);
  });

  it("handles text with no JSON", () => {
    const raw = "This is a normal response without any JSON.";
    const { textCalls, cleanText } = extractAndCleanText(raw);
    expect(textCalls).toHaveLength(0);
    expect(cleanText).toBe(raw);
  });

  it("handles highlights in JSON", () => {
    const raw =
      '好的！\n{"destination":"云南","highlights":[{"label":"出发地点","value":"深圳龙华"}]}';
    const { textCalls, cleanText } = extractAndCleanText(raw);
    expect(textCalls).toHaveLength(1);
    expect(textCalls[0].name).toBe("update_collected_info");
    const args = textCalls[0].args as Record<string, unknown>;
    expect(args.destination).toBe("云南");
    expect(args.highlights).toEqual([{ label: "出发地点", value: "深圳龙华" }]);
    expect(cleanText).toContain("好的");
    expect(cleanText).not.toContain("destination");
  });

  it("cleans up excessive newlines after stripping", () => {
    const raw = '好的！\n\n\n{"destination":"云南"}';
    const { cleanText } = extractAndCleanText(raw);
    expect(cleanText).not.toMatch(/\n{3,}/);
  });
});
