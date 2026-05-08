// src/lib/fetch-utils.ts

const DEFAULT_TIMEOUT = 10000;
const MAX_RETRIES = 2;

export async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = MAX_RETRIES,
  delay: number = 1000,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    // Do not retry client errors (4xx) — they won't succeed on retry
    if (error instanceof Error && error.message.startsWith("HTTP 4")) {
      throw error;
    }
    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
}

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
    clearTimeout(timeoutId);
  }
}
