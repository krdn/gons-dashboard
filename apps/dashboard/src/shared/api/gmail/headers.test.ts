import { describe, it, expect } from "vitest";
import {
  rowToSignals,
  isSignalRowUnpopulated,
  type PersistedSignalRow,
} from "./headers";

// #20 회귀 가드 (순수 seam) — DB 영속화 신호 행 → MailingListSignals 변환.
// "신호가 isMailingList prefilter까지 도달하는가" 합성 검증은 FSD boundary상
// entities를 import할 수 없어 tests/unsubscribe-filter.test.ts에 둔다.

describe("rowToSignals", () => {
  it("List-Unsubscribe 영속화 행 → hasListUnsubscribe=true", () => {
    const row: PersistedSignalRow = {
      hasListUnsubscribe: true,
      hasListId: false,
      precedence: null,
      fromHeader: "news@example.com",
    };
    expect(rowToSignals(row).hasListUnsubscribe).toBe(true);
  });

  it("precedence/fromHeader는 그대로 보존", () => {
    const row: PersistedSignalRow = {
      hasListUnsubscribe: false,
      hasListId: true,
      precedence: "bulk",
      fromHeader: "list@example.com",
    };
    const signals = rowToSignals(row);
    expect(signals.hasListId).toBe(true);
    expect(signals.precedence).toBe("bulk");
    expect(signals.fromHeader).toBe("list@example.com");
  });

  it("NULL boolean은 false로 좁힘 (미채집 = 신호 없음으로 안전 처리)", () => {
    const row: PersistedSignalRow = {
      hasListUnsubscribe: null,
      hasListId: null,
      precedence: null,
      fromHeader: "person@example.com",
    };
    const signals = rowToSignals(row);
    expect(signals.hasListUnsubscribe).toBe(false);
    expect(signals.hasListId).toBe(false);
    expect(signals.precedence).toBe(null);
  });
});

describe("isSignalRowUnpopulated", () => {
  it("3개 신호 컬럼이 전부 NULL이면 미채집 (lazy 재채집 대상)", () => {
    expect(
      isSignalRowUnpopulated({
        hasListUnsubscribe: null,
        hasListId: null,
        precedence: null,
        fromHeader: "x@y.com",
      }),
    ).toBe(true);
  });

  it("하나라도 채집됐으면 populated (재채집 불필요)", () => {
    expect(
      isSignalRowUnpopulated({
        hasListUnsubscribe: false,
        hasListId: null,
        precedence: null,
        fromHeader: "x@y.com",
      }),
    ).toBe(false);
  });

  it("신호가 true로 채집된 행도 populated", () => {
    expect(
      isSignalRowUnpopulated({
        hasListUnsubscribe: true,
        hasListId: false,
        precedence: "bulk",
        fromHeader: "x@y.com",
      }),
    ).toBe(false);
  });
});
