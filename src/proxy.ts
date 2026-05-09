// src/proxy.ts
// Next.js 16 代理（Proxy）— 请求限流中间件
//
// ── Next.js 16 的变化 ──
// Next.js 16 用 proxy() 函数替代了之前的 middleware.ts。
// 功能相同: 在请求到达 API route 之前进行拦截和处理。
//
// ── 令牌桶限流算法（Token Bucket）──
// 每个 IP 有一个"令牌桶"，桶里最多装 MAX_REQUESTS 个令牌。
// 每次请求消耗 1 个令牌，桶空了就拒绝请求。
// 每过 WINDOW_MS 时间，桶自动补充令牌。
//
// 这种算法的优点:
// - 允许短时间的突发流量（桶里有积累的令牌）
// - 长期来看限制了请求速率
// - 比固定窗口更平滑（不会出现窗口边界处的突刺）
//
// ── Serverless 环境的特殊处理 ──
// 在 Vercel Serverless 中，不能用 setInterval 定时清理（函数可能随时被回收）。
// 所以用"惰性清理": 每次请求时检查并删除过期条目。

import { NextRequest, NextResponse } from "next/server";

/** 每个 IP 的令牌桶状态 */
interface RateLimitEntry {
  tokens: number; // 当前剩余令牌数
  lastRefill: number; // 上次补充令牌的时间戳
}

const WINDOW_MS = 60_000; // 1 分钟窗口
const MAX_REQUESTS = 10; // 每窗口最多 10 次请求

// 内存存储（Serverless 环境中，每个实例独立，重启后丢失）
const store = new Map<string, RateLimitEntry>();

/** 惰性清理: 删除 2 个窗口前的过期条目（节省内存） */
function cleanupStaleEntries(): void {
  const cutoff = Date.now() - WINDOW_MS * 2;
  for (const [key, entry] of store) {
    if (entry.lastRefill < cutoff) store.delete(key);
  }
}

/** 从请求头提取客户端 IP */
function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * 检查限流: 消耗一个令牌，返回是否允许和剩余令牌数。
 *
 * 令牌补充逻辑:
 * - 根据经过的时间计算应补充的令牌数
 * - 例如: 距上次补充过了 60s → 补充 MAX_REQUESTS 个令牌
 * - 桶满时不再补充（上限 MAX_REQUESTS）
 */
function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  cleanupStaleEntries();
  const now = Date.now();
  let entry = store.get(ip);

  if (!entry) {
    // 新 IP → 创建条目，消耗第一个令牌
    entry = { tokens: MAX_REQUESTS - 1, lastRefill: now };
    store.set(ip, entry);
    return { allowed: true, remaining: entry.tokens };
  }

  // 根据经过的时间补充令牌
  const elapsed = now - entry.lastRefill;
  const refill = Math.floor(elapsed / WINDOW_MS) * MAX_REQUESTS;
  if (refill > 0) {
    entry.tokens = Math.min(MAX_REQUESTS, entry.tokens + refill);
    entry.lastRefill = now;
  }

  // 桶空 → 拒绝
  if (entry.tokens <= 0) {
    return { allowed: false, remaining: 0 };
  }

  // 消耗一个令牌
  entry.tokens -= 1;
  return { allowed: true, remaining: entry.tokens };
}

/**
 * Next.js 16 proxy 函数: 在请求到达 API route 前执行。
 *
 * 只对 POST /api/chat 限流（其他请求直接放行）。
 * 返回 429 Too Many Requests 时，附带 Retry-After 头告诉客户端何时重试。
 */
export function proxy(req: NextRequest) {
  // 只限流 POST /api/chat
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

  // 放行，附带限流信息头
  const response = NextResponse.next();
  response.headers.set("X-RateLimit-Limit", String(MAX_REQUESTS));
  response.headers.set("X-RateLimit-Remaining", String(remaining));
  return response;
}
