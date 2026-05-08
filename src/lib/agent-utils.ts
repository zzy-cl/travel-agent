import type { AIMessage } from "@langchain/core/messages";
import type { CollectedInfo } from "../schemas/collected-info";
import { collectedInfoSchema } from "../schemas/collected-info";

/**
 * Convert a tool execution result to a string for ToolMessage content.
 * Handles both string results and structured objects.
 */
export function stringifyToolResult(result: unknown): string {
  return typeof result === "string" ? result : JSON.stringify(result);
}

interface TextBlock {
  type: "text";
  text: string;
}

/** Type guard for LangChain text content blocks. */
export function isTextBlock(block: unknown): block is TextBlock {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as TextBlock).type === "text" &&
    typeof (block as TextBlock).text === "string"
  );
}

/**
 * Extract the text content from an AIMessage.
 * Handles both string content and content block arrays.
 */
export function extractTextContent(message: AIMessage): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(isTextBlock)
      .map((b) => b.text)
      .join("");
  }
  return "";
}

/**
 * Merge a partial collectedInfo update into the current state.
 * Handles highlights deduplication by label (keeps latest).
 * Skips empty arrays to preserve existing values.
 */
export function mergeCollectedInfo(current: CollectedInfo, args: unknown): CollectedInfo {
  const parsed = collectedInfoSchema.partial().safeParse(args);
  if (!parsed.success) return current;
  const raw = parsed.data;

  // Merge highlights: deduplicate by label (keep latest), append new ones
  const mergedHighlights = [...(current.highlights ?? [])];
  if (raw.highlights?.length) {
    for (const hl of raw.highlights) {
      const idx = mergedHighlights.findIndex((h) => h.label === hl.label);
      if (idx >= 0) {
        mergedHighlights[idx] = hl;
      } else {
        mergedHighlights.push(hl);
      }
    }
  }

  // Build scalar / simple-array updates (skip highlights — handled above, skip empty arrays)
  const scalarUpdates = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => {
      if (v === undefined) return false;
      if (Array.isArray(v)) {
        if (v.length === 0) return false;
        // Skip highlights arrays (merged separately above)
        if (v.length > 0 && typeof v[0] === "object" && v[0] !== null && "label" in v[0])
          return false;
      }
      return true;
    }),
  );

  return {
    ...current,
    ...scalarUpdates,
    highlights: mergedHighlights,
    preferences: scalarUpdates.preferences ?? current.preferences,
    constraints: scalarUpdates.constraints ?? current.constraints,
  } as CollectedInfo;
}
