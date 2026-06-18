// 분류 lookback 윈도우 결정 로직 회귀 가드 (감사 #5 — digest 윈도우 불일치).
//
// 버그: fullRescan은 newer_than:7d로 7일치를 적재하는데 분류 루프는 24h만 돌아
// 24h~7d 구간 스레드가 영구 분류 누락. 분류는 저장형(row INSERT)이라 자가회복 안 됨.
//
// 이 테스트는 "적재한 만큼 분류한다" 불변식을 순수 단위로 고정한다.
import { describe, it, expect } from "vitest";
import {
  classifyLookbackMs,
  RESCAN_LOOKBACK_DAYS,
  INCREMENTAL_LOOKBACK_HOURS,
} from "./classify-window";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe("classifyLookbackMs", () => {
  it("first-sync는 rescan 적재 윈도우(7일)를 분류한다", () => {
    // fullRescan이 7일치를 적재하므로 분류도 7일을 봐야 24h~7d 누락이 안 생긴다.
    expect(classifyLookbackMs("first-sync")).toBe(RESCAN_LOOKBACK_DAYS * DAY_MS);
  });

  it("full-rescan(stale fallback)도 동일하게 7일을 분류한다", () => {
    expect(classifyLookbackMs("full-rescan")).toBe(
      RESCAN_LOOKBACK_DAYS * DAY_MS,
    );
  });

  it("incremental은 핫패스 비용 억제를 위해 24h만 분류한다", () => {
    // incremental은 매 cron마다 도는 핫패스. classifyThread가 LLM 전에 멱등
    // 단락을 안 하므로 윈도우를 넓히면 매 cron이 그만큼 LLM을 재청구한다.
    expect(classifyLookbackMs("incremental")).toBe(
      INCREMENTAL_LOOKBACK_HOURS * HOUR_MS,
    );
  });

  it("rescan 경로 윈도우가 incremental보다 넓다 (버그 재발 방지 불변식)", () => {
    // 두 윈도우가 다시 같아지면(과거의 24h 통일) 24h~7d 누락 버그가 재현된다.
    expect(classifyLookbackMs("first-sync")).toBeGreaterThan(
      classifyLookbackMs("incremental"),
    );
  });

  it("rescan 분류 윈도우는 fullRescan 적재 윈도우와 같은 상수에서 파생된다", () => {
    // drift 재발 방지: 적재(newer_than:Nd)와 분류(since) 윈도우는 단일 출처여야 한다.
    expect(classifyLookbackMs("first-sync")).toBe(RESCAN_LOOKBACK_DAYS * DAY_MS);
    expect(RESCAN_LOOKBACK_DAYS).toBe(7);
  });
});
