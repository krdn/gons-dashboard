import { describe, it, expect } from "vitest";
import { computeKrw } from "./pricing";

describe("computeKrw", () => {
  it("haiku 단가로 환산한다", () => {
    // input 0.8 USD/M, output 4 USD/M, 1380 KRW/USD
    // 1M in + 1M out = (0.8 + 4) USD = 4.8 USD = 6624 KRW
    const krw = computeKrw("claude-haiku-4-5-20251001", 1_000_000, 1_000_000);
    expect(krw).toBe(6624);
  });

  it("sonnet 단가로 환산한다", () => {
    // (3 + 15) USD = 18 USD = 24840 KRW
    const krw = computeKrw("claude-sonnet-4-6", 1_000_000, 1_000_000);
    expect(krw).toBe(24840);
  });

  it("opus 정확 매칭 없이 prefix 폴백으로 환산한다", () => {
    // claude-opus-4-8 → OPUS_PRICING (15 + 75) USD = 90 USD = 124200 KRW
    const krw = computeKrw("claude-opus-4-8", 1_000_000, 1_000_000);
    expect(krw).toBe(124200);
  });

  it("알 수 없는 모델은 opus 단가로 폴백한다 (기본 모델이 opus)", () => {
    const known = computeKrw("claude-opus-4-8", 500_000, 200_000);
    const unknown = computeKrw("some-future-model", 500_000, 200_000);
    expect(unknown).toBe(known);
  });

  it("소수 둘째 자리로 반올림한다", () => {
    // haiku, 1234 in / 567 out → 매우 작은 금액, 반올림 확인
    const krw = computeKrw("claude-haiku-4-5-20251001", 1234, 567);
    // (1234/1e6*0.8 + 567/1e6*4) * 1380 = (0.0009872 + 0.002268) * 1380
    //  = 0.0032552 * 1380 = 4.492176 → round(*100)/100 = 4.49
    expect(krw).toBe(4.49);
  });

  it("토큰 0이면 0 KRW", () => {
    expect(computeKrw("claude-opus-4-8", 0, 0)).toBe(0);
  });
});
