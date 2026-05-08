import { NextRequest, NextResponse } from "next/server";

// ── In-memory rate limiter (per Vercel function instance) ──
// For distributed rate limiting across instances, use Upstash Redis:
//   npm install @upstash/ratelimit @upstash/redis

interface RateLimitEntry {
  tokens: number;
  lastRefill: number;
}

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 10; // 10 requests per minute per IP

const store = new Map<string, RateLimitEntry>();

// Cleanup stale entries lazily on each request (serverless-safe — no setInterval)
function cleanupStaleEntries(): void {
  const cutoff = Date.now() - WINDOW_MS * 2;
  for (const [key, entry] of store) {
    if (entry.lastRefill < cutoff) store.delete(key);
  }
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  cleanupStaleEntries();
  const now = Date.now();
  let entry = store.get(ip);

  if (!entry) {
    entry = { tokens: MAX_REQUESTS - 1, lastRefill: now };
    store.set(ip, entry);
    return { allowed: true, remaining: entry.tokens };
  }

  // Refill tokens based on elapsed time
  const elapsed = now - entry.lastRefill;
  const refill = Math.floor(elapsed / WINDOW_MS) * MAX_REQUESTS;
  if (refill > 0) {
    entry.tokens = Math.min(MAX_REQUESTS, entry.tokens + refill);
    entry.lastRefill = now;
  }

  if (entry.tokens <= 0) {
    return { allowed: false, remaining: 0 };
  }

  entry.tokens -= 1;
  return { allowed: true, remaining: entry.tokens };
}

// ── Proxy (Next.js 16 convention, replaces middleware) ──

export function proxy(req: NextRequest) {
  // Only rate-limit POST /api/chat
  if (req.nextUrl.pathname !== "/api/chat" || req.method !== "POST") {
    return NextResponse.next();
  }

  const ip = getClientIp(req);
  const { allowed, remaining } = checkRateLimit(ip);

  if (!allowed) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      {
        status: 429,
        headers: {
          "Retry-After": "60",
          "X-RateLimit-Limit": String(MAX_REQUESTS),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  const response = NextResponse.next();
  response.headers.set("X-RateLimit-Limit", String(MAX_REQUESTS));
  response.headers.set("X-RateLimit-Remaining", String(remaining));
  return response;
}
