// src/lib/fetch-utils.ts
// 网络请求工具函数
//
// 提供两个核心能力：
// 1. fetchWithTimeout — 带超时控制的 fetch（默认 10s）
// 2. withRetry — 失败自动重试，使用指数退避策略（1s → 2s → 4s）
//
// 所有外部 API 调用（天气、搜索、地图）都通过这两个函数发起，
// 确保单次请求不会无限等待，且临时网络故障可自动恢复。

const DEFAULT_TIMEOUT = 10000; // 10 秒超时
const MAX_RETRIES = 2; // 最多重试 2 次（共 3 次尝试）

/**
 * 带指数退避的重试包装器。
 *
 * exponential backoff（指数退避）: 每次重试等待时间翻倍。
 * 例如 delay=1000ms 时：第 1 次重试等 1s，第 2 次等 2s。
 * 这样可以避免在服务端过载时加重负担。
 *
 * 特殊处理: HTTP 4xx（客户端错误）不重试，因为重试也不会成功。
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = MAX_RETRIES,
  delay: number = 1000,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    // 4xx 是客户端错误（如 401 未授权、404 不存在），重试无意义
    if (error instanceof Error && error.message.startsWith("HTTP 4")) {
      throw error;
    }
    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2); // delay 翻倍
    }
    throw error;
  }
}

/**
 * 带超时控制的 fetch。
 *
 * 使用 AbortController 实现: 超时后自动取消请求，防止无限挂起。
 * 这在网络不稳定或外部 API 无响应时尤为重要。
 */
export async function fetchWithTimeout(
  url: string,
  timeout: number = DEFAULT_TIMEOUT,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId); // 请求完成（无论成功/失败）后清除定时器
  }
}
