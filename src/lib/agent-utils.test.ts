import { describe, it, expect } from "vitest";
import {
  stringifyToolResult,
  extractTextContent,
  mergeCollectedInfo,
  isTextBlock,
} from "./agent-utils";
import { AIMessage } from "@langchain/core/messages";

describe("stringifyToolResult", () => {
  it("returns string as-is", () => {
    expect(stringifyToolResult("hello")).toBe("hello");
  });

  it("stringifies objects", () => {
    expect(stringifyToolResult({ foo: "bar" })).toBe('{"foo":"bar"}');
  });

  it("stringifies arrays", () => {
    expect(stringifyToolResult([1, 2, 3])).toBe("[1,2,3]");
  });

  it("stringifies null", () => {
    expect(stringifyToolResult(null)).toBe("null");
  });

  it("stringifies numbers", () => {
    expect(stringifyToolResult(42)).toBe("42");
  });
});

describe("isTextBlock", () => {
  it("returns true for valid text block", () => {
    expect(isTextBlock({ type: "text", text: "hello" })).toBe(true);
  });

  it("returns false for non-text block", () => {
    expect(isTextBlock({ type: "thinking", thinking: "hmm" })).toBe(false);
  });

  it("returns false for null", () => {
    expect(isTextBlock(null)).toBe(false);
  });

  it("returns false for string", () => {
    expect(isTextBlock("text")).toBe(false);
  });

  it("returns false for text block without text field", () => {
    expect(isTextBlock({ type: "text" })).toBe(false);
  });
});

describe("extractTextContent", () => {
  it("extracts string content", () => {
    const msg = new AIMessage("hello world");
    expect(extractTextContent(msg)).toBe("hello world");
  });

  it("extracts text from content blocks", () => {
    const msg = new AIMessage({
      content: [
        { type: "text", text: "part1 " },
        { type: "text", text: "part2" },
      ],
    });
    expect(extractTextContent(msg)).toBe("part1 part2");
  });

  it("filters out non-text blocks", () => {
    const msg = new AIMessage({
      content: [
        { type: "thinking", thinking: "internal" },
        { type: "text", text: "visible" },
      ],
    });
    expect(extractTextContent(msg)).toBe("visible");
  });

  it("returns empty string for empty content", () => {
    const msg = new AIMessage("");
    expect(extractTextContent(msg)).toBe("");
  });
});

describe("mergeCollectedInfo", () => {
  const defaults = { preferences: [], constraints: [], highlights: [] };

  it("merges scalar fields", () => {
    const result = mergeCollectedInfo(defaults, { destination: "云南", days: 5 });
    expect(result.destination).toBe("云南");
    expect(result.days).toBe(5);
  });

  it("preserves existing fields when not overridden", () => {
    const current = { ...defaults, destination: "云南", days: 5 };
    const result = mergeCollectedInfo(current, { budget: "3000" });
    expect(result.destination).toBe("云南");
    expect(result.days).toBe(5);
    expect(result.budget).toBe("3000");
  });

  it("merges highlights by label (keeps latest)", () => {
    const current = {
      ...defaults,
      highlights: [{ label: "出发地点", value: "深圳" }],
    };
    const result = mergeCollectedInfo(current, {
      highlights: [{ label: "出发地点", value: "广州" }],
    });
    expect(result.highlights).toHaveLength(1);
    expect(result.highlights[0]).toEqual({ label: "出发地点", value: "广州" });
  });

  it("appends new highlights", () => {
    const current = {
      ...defaults,
      highlights: [{ label: "出发地点", value: "深圳" }],
    };
    const result = mergeCollectedInfo(current, {
      highlights: [{ label: "必去景点", value: "丽江古城" }],
    });
    expect(result.highlights).toHaveLength(2);
  });

  it("skips empty arrays", () => {
    const current = { ...defaults, preferences: ["美食"] };
    const result = mergeCollectedInfo(current, { preferences: [] });
    expect(result.preferences).toEqual(["美食"]);
  });

  it("replaces non-empty arrays", () => {
    const current = { ...defaults, preferences: ["美食"] };
    const result = mergeCollectedInfo(current, { preferences: ["自然风光"] });
    expect(result.preferences).toEqual(["自然风光"]);
  });

  it("ignores invalid data", () => {
    const result = mergeCollectedInfo(defaults, "not an object");
    expect(result).toEqual(defaults);
  });

  it("ignores non-schema fields", () => {
    const result = mergeCollectedInfo(defaults, { unknownField: "value" });
    expect(result).toEqual(defaults);
  });
});
