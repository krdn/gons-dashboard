import { describe, it, expect } from "vitest";
import {
  evaluateGuards,
  MIN_OPEN_MINUTES,
} from "@/features/monitoring-remediate/lib/guards";

const NOW = new Date("2026-07-28T12:00:00Z");
const base = {
  severity: "critical",
  occurredAt: new Date("2026-07-28T10:00:00Z"), // 120분 전
  maxAttempts: 3,
  cooldownMinutes: 60,
  history: [] as { outcome: string; attemptedAt: Date }[],
  now: NOW,
};

describe("evaluateGuards", () => {
  it("조건을 모두 만족하면 허용", () => {
    expect(evaluateGuards(base)).toEqual({ allowed: true });
  });

  // 이벤트 278건 중 86%가 평균 0.1h 에 자해소한다. 지속시간 게이트가
  // 그 대다수를 조치 대상에서 제외하는 것이 이 설계의 1차 방어선이다.
  it("최소 지속 시간 미달이면 거부", () => {
    const v = evaluateGuards({
      ...base,
      occurredAt: new Date("2026-07-28T11:45:00Z"), // 15분 전 < 30분
    });
    expect(v.allowed).toBe(false);
    expect(v).toMatchObject({ reason: expect.stringContaining("지속") });
  });

  it("warning 은 critical 보다 긴 지속을 요구", () => {
    const oneHourAgo = new Date("2026-07-28T11:00:00Z");
    expect(evaluateGuards({ ...base, severity: "critical", occurredAt: oneHourAgo }).allowed).toBe(true);
    expect(evaluateGuards({ ...base, severity: "warning", occurredAt: oneHourAgo }).allowed).toBe(false);
  });

  it("시도 횟수 상한 초과면 거부", () => {
    const v = evaluateGuards({
      ...base,
      history: [
        { outcome: "executed", attemptedAt: new Date("2026-07-25T00:00:00Z") },
        { outcome: "executed", attemptedAt: new Date("2026-07-26T00:00:00Z") },
        { outcome: "failed", attemptedAt: new Date("2026-07-27T00:00:00Z") },
      ],
    });
    expect(v.allowed).toBe(false);
    expect(v).toMatchObject({ reason: expect.stringContaining("시도") });
  });

  it("skipped 는 시도 횟수에 포함하지 않는다", () => {
    const history = Array.from({ length: 5 }, (_, i) => ({
      outcome: "skipped",
      attemptedAt: new Date(`2026-07-2${i + 1}T00:00:00Z`),
    }));
    expect(evaluateGuards({ ...base, history }).allowed).toBe(true);
  });

  it("쿨다운 중이면 거부", () => {
    const v = evaluateGuards({
      ...base,
      history: [{ outcome: "executed", attemptedAt: new Date("2026-07-28T11:30:00Z") }], // 30분 전 < 60분
    });
    expect(v.allowed).toBe(false);
    expect(v).toMatchObject({ reason: expect.stringContaining("쿨다운") });
  });

  it("in_flight 가 있으면 거부", () => {
    const v = evaluateGuards({
      ...base,
      history: [{ outcome: "in_flight", attemptedAt: new Date("2026-07-28T11:59:00Z") }],
    });
    expect(v.allowed).toBe(false);
    expect(v).toMatchObject({ reason: expect.stringContaining("실행 중") });
  });

  it("MIN_OPEN_MINUTES 는 critical 30분 / warning 6시간", () => {
    expect(MIN_OPEN_MINUTES.critical).toBe(30);
    expect(MIN_OPEN_MINUTES.warning).toBe(360);
  });
});
