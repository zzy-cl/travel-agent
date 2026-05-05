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
  startTime: number;
  totalDuration: number;
}

const MAX_LOGS = 10_000;
const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// In-memory log store (replace with DB in production)
const logs: CallLog[] = [];
const sessionCosts = new Map<string, SessionCost>();

function evictOldSessions(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, cost] of sessionCosts) {
    if (cost.startTime < cutoff) sessionCosts.delete(id);
  }
}

export function logCall(log: CallLog): void {
  // Cap log array
  if (logs.length >= MAX_LOGS) {
    logs.splice(0, logs.length - MAX_LOGS + 1);
  }
  logs.push(log);

  // Update session cost
  const existing = sessionCosts.get(log.sessionId);
  if (existing) {
    existing.llmCalls += log.type === "llm" ? 1 : 0;
    existing.toolCalls += log.type === "tool" ? 1 : 0;
    existing.totalTokens += log.inputTokens + log.outputTokens;
    existing.totalCost += log.cost;
    existing.totalDuration += log.duration;
  } else {
    sessionCosts.set(log.sessionId, {
      sessionId: log.sessionId,
      llmCalls: log.type === "llm" ? 1 : 0,
      toolCalls: log.type === "tool" ? 1 : 0,
      totalTokens: log.inputTokens + log.outputTokens,
      totalCost: log.cost,
      startTime: Date.now(),
      totalDuration: log.duration,
    });
  }

  // Periodic cleanup of old sessions
  if (sessionCosts.size > 100) {
    evictOldSessions();
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
  if (model.includes("deepseek")) {
    return (inputTokens * 1 + outputTokens * 2) / 1_000_000;
  }
  if (model.includes("claude")) {
    return (inputTokens * 3 + outputTokens * 15) / 1_000_000;
  }
  return 0;
}
