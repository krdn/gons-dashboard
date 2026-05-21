const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY = 1;
const UA = "Mozilla/5.0 (gons-dashboard/0.1; stock-analysis adapter)";

export class YahooFetchError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly url?: string,
  ) {
    super(message);
    this.name = "YahooFetchError";
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  retry?: number;
}

export async function yahooFetchJson<T>(
  url: string,
  opts: FetchOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.retry ?? DEFAULT_RETRY;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        throw new YahooFetchError(
          `Yahoo ${res.status} ${res.statusText}`,
          res.status,
          url,
        );
      }
      return (await res.json()) as T;
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
      }
    }
  }
  throw new YahooFetchError(
    `Yahoo fetch failed after ${maxRetries + 1} attempts: ${lastError?.message ?? "unknown"}`,
    undefined,
    url,
  );
}
