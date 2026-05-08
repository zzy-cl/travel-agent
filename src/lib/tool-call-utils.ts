/** Known keys for collectedInfo — used to recognize update_collected_info JSON in text */
export const INFO_KEYS = [
  "destination",
  "days",
  "people",
  "budget",
  "dateRange",
  "preferences",
  "constraints",
  "transport",
  "accommodation",
  "highlights",
];

/**
 * DeepSeek through the Anthropic-compatible API sometimes outputs tool calls as
 * plain-text JSON at the end of the response instead of using structured tool_use blocks.
 *
 * This scans the response text for trailing JSON objects that look like collectedInfo
 * tool call arguments, and returns them as pseudo-tool-calls + the cleaned text.
 */
export function extractAndCleanText(rawText: string): {
  textCalls: Array<{ name: string; args: unknown }>;
  cleanText: string;
} {
  const textCalls: Array<{ name: string; args: unknown }> = [];

  // Find standalone JSON objects at the end of the text (greedy match from end)
  const jsonPattern = /\{(?:[^{}]|"(?:[^"\\]|\\.)*"|\{(?:[^{}]|"(?:[^"\\]|\\.)*")*\})*\}/g;
  const matches = [...rawText.matchAll(jsonPattern)];

  let cleanText = rawText;

  // Process matches in reverse order (trailing JSON first)
  const reversed = [...matches].reverse();
  for (const m of reversed) {
    try {
      const parsed = JSON.parse(m[0]);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const keys = Object.keys(parsed);
        // Is this an update_collected_info call? (has recognized info keys)
        if (keys.some((k) => INFO_KEYS.includes(k))) {
          textCalls.push({ name: "update_collected_info", args: parsed });
          // Strip this JSON from the text — it's a tool call, not content for the user
          cleanText = cleanText.replace(m[0], "").trim();
        } else if (keys.length === 0) {
          // Empty object — likely confirm_info
          textCalls.push({ name: "confirm_info", args: {} });
          cleanText = cleanText.replace(m[0], "").trim();
        }
        // Only process the LAST tool-call-like JSON (most recent)
        if (textCalls.length > 0) break;
      }
    } catch {
      // Not valid JSON — leave in text
    }
  }

  // Clean up trailing whitespace/punctuation left by stripping
  cleanText = cleanText.replace(/\n{3,}/g, "\n\n").trim();

  return { textCalls, cleanText };
}
