// 분류 lookback 윈도우 정책 — 순수(시계·DB 의존 없음).
//
// 감사 #5: fullRescan은 newer_than:7d로 7일치를 적재하는데 분류 루프가 24h만 돌아
// 24h~7d 구간 스레드가 영구 분류 누락됐다(분류는 저장형 row INSERT라 자가회복 X).
//
// 불변식 = "적재한 만큼 분류한다":
//   - rescan 경로(first-sync / stale fallback)는 적재 윈도우(7일)를 그대로 분류.
//   - incremental은 핫패스(매 cron)라 24h로 가둔다. classifyThread가 LLM 호출 전
//     멱등 단락을 하지 않으므로, incremental 윈도우를 넓히면 매 cron이 그만큼
//     LLM을 재청구한다(이 감사가 잡으려던 Haiku 비용 누수의 재발).

/** fullRescan이 fetch·적재하는 윈도우. newer_than:${N}d 쿼리와 분류 since의 단일 출처. */
export const RESCAN_LOOKBACK_DAYS = 7;

/** incremental sync가 분류하는 핫패스 윈도우(시간). */
export const INCREMENTAL_LOOKBACK_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** 분류 루프가 거슬러 올라가는 윈도우의 종류. syncInbox 분기와 1:1. */
export type SyncContext = "first-sync" | "full-rescan" | "incremental";

/**
 * 분류 lookback 길이(ms) 반환. 호출자가 new Date(Date.now() - lookbackMs)로 since 산출.
 *
 * rescan 경로는 적재 윈도우(RESCAN_LOOKBACK_DAYS)와 같은 상수에서 파생 — 두 윈도우의
 * drift가 이 버그의 근본이었으므로 한 상수로 묶어 재발을 구조적으로 막는다.
 */
export function classifyLookbackMs(context: SyncContext): number {
  switch (context) {
    case "first-sync":
    case "full-rescan":
      return RESCAN_LOOKBACK_DAYS * DAY_MS;
    case "incremental":
      return INCREMENTAL_LOOKBACK_HOURS * HOUR_MS;
  }
}
