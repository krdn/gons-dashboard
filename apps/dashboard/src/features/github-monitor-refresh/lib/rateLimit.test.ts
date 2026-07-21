import { describe, expect, it } from "vitest";
import { checkCooldown } from "./rateLimit";

const WINDOW = 30_000;

describe("checkCooldown", () => {
  it("최초 호출(lastAt=null)은 허용", () => {
    expect(checkCooldown(null, 1_000, WINDOW)).toEqual({
      allowed: true,
      remainingSec: 0,
    });
  });

  it("윈도우 내 재호출은 거부하고 남은 초를 올림한다", () => {
    // 마지막 호출 1000ms, 현재 6000ms → 5초 경과, 25초 남음
    expect(checkCooldown(1_000, 6_000, WINDOW)).toEqual({
      allowed: false,
      remainingSec: 25,
    });
  });

  it("윈도우 경계(정확히 30초)는 허용", () => {
    expect(checkCooldown(1_000, 31_000, WINDOW)).toEqual({
      allowed: true,
      remainingSec: 0,
    });
  });

  it("남은 초는 올림 처리 — 24.1초 남으면 25 반환", () => {
    // 마지막 1000, 현재 6900 → 5.9초 경과, 24.1초 남음 → ceil = 25
    expect(checkCooldown(1_000, 6_900, WINDOW)).toEqual({
      allowed: false,
      remainingSec: 25,
    });
  });
});
