// YahooFetchError — yahoo-finance2 migration 후에도 public API 로 export 유지.
// 외부 호출자가 error type narrowing 에 사용할 수 있음.
// yahooFetchJson 직접 fetch wrapper 는 yahoo-finance2 client 로 대체되어 제거됨 (2026-05-22).

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
