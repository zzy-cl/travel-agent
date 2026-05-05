export interface CallLog {
  timestamp: Date;
  userId: string;
  sessionId: string;
  node: string;
  type: "llm" | "tool";
  model?: string;
  toolName?: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  duration: number;
  success: boolean;
}

export interface SessionCost {
  sessionId: string;
  llmCalls: number;
  toolCalls: number;
  totalTokens: number;
  totalCost: number;
  duration: number;
}

// In-memory log store (replace with DB in production)
const logs: CallLog[] = [];
const sessionCosts = new Map<string, SessionCost>();

export function logCall(log: CallLog): void {
  logs.push(log);

  // Update session cost
  const existing = sessionCosts.get(log.sessionId);
  if (existing) {
    existing.llmCalls += log.type === "llm" ? 1 : 0;
    existing.toolCalls += log.type === "tool" ? 1 : 0;
    existing.totalTokens += log.inputTokens + log.outputTokens;
    existing.totalCost += log.cost;
    existing.duration = Date.now() - existing.duration;
  } else {
    sessionCosts.set(log.sessionId, {
      sessionId: log.sessionId,
      llmCalls: log.type === "llm" ? 1 : 0,
      toolCalls: log.type === "tool" ? 1 : 0,
      totalTokens: log.inputTokens + log.outputTokens,
      totalCost: log.cost,
      duration: Date.now(),
    });
  }

  // Console output for development
  if (process.env.NODE_ENV !== "production") {
    const costStr = log.cost > 0 ? ` ¥${log.cost.toFixed(4)}` : "";
    console.log(
      `[${log.type.toUpperCase()}] ${log.node}${log.toolName ? `/${log.toolName}` : ""} — ${log.duration}ms${costStr} ${log.success ? "✓" : "✗"}`,
    );
  }
}

export function getSessionCost(sessionId: string): SessionCost | null {
  return sessionCosts.get(sessionId) || null;
}

export function getRecentLogs(limit = 50): CallLog[] {
  return logs.slice(-limit);
}

// Cost calculation (approximate, based on DeepSeek pricing)
export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  // DeepSeek v4 Pro: ~¥1/M input, ¥2/M output
  if (model.includes("deepseek")) {
    return (inputTokens * 1 + outputTokens * 2) / 1_000_000;
  }
  return 0;
}
