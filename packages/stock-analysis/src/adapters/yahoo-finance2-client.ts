// yahoo-finance2 v3 wrapper — v7/finance/quote 가 2024년부터 crumb cookie 를 요구하면서
// 익명 호출이 401, v8 도 rate limit (429) 으로 신뢰 불가. yahoo-finance2 가 crumb 자동
// 처리 + retry + cookie 관리 → 단일 진입점.
//
// 모듈 초기화 비용 (cookie/crumb fetch) 이 있어 client 는 lazy singleton.
// packages/stock-analysis 는 Node-only 라이브러리 — server-only enforce 는
// dashboard features 레이어에서 처리 (apps/dashboard/src/features/stock-analysis-server).

import YahooFinance from "yahoo-finance2";

// YahooFinance default export 는 const 인스턴스 — 동일 타입을 ReturnType 으로 추출.
// 직접 `typeof YahooFinance` 는 yahoo-finance2 의 generic constructor 타입과 헷갈려
// `not assignable` 오류를 낸다 (overload signature 분리 결과).
type YahooClient = InstanceType<{ new (): typeof YahooFinance }>;

let _client: YahooClient | null = null;

export function getYahooClient(): YahooClient {
  if (_client === null) {
    _client = new YahooFinance({
      // 첫 호출 시 한 번 stderr 에 survey 안내가 떠서 운영 로그 노이즈 — 끈다.
      suppressNotices: ["yahooSurvey"],
    }) as unknown as YahooClient;
  }
  return _client;
}
