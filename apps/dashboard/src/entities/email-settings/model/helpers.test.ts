import { describe, it, expect } from "vitest";
import {
  meetsSeverity,
  meetsImportance,
  isSyncDue,
  isDigestDue,
  EMAIL_SETTINGS_DEFAULTS,
} from "./types";

describe("meetsSeverity", () => {
  it("high item은 med threshold를 통과", () => {
    expect(meetsSeverity("high", "med")).toBe(true);
  });
  it("low item은 med threshold를 통과 못함", () => {
    expect(meetsSeverity("low", "med")).toBe(false);
  });
  it("med item은 med threshold를 통과(경계 포함)", () => {
    expect(meetsSeverity("med", "med")).toBe(true);
  });
  it("low threshold는 모두 통과", () => {
    expect(meetsSeverity("low", "low")).toBe(true);
    expect(meetsSeverity("high", "low")).toBe(true);
  });
});

describe("meetsImportance", () => {
  it("high는 med threshold 통과", () => {
    expect(meetsImportance("high", "med")).toBe(true);
  });
  it("med는 high threshold 통과 못함", () => {
    expect(meetsImportance("med", "high")).toBe(false);
  });
});

describe("isSyncDue", () => {
  const now = new Date("2026-06-15T10:00:00Z");
  it("lastSyncAt 없으면 due", () => {
    expect(isSyncDue(now, null, 60)).toBe(true);
  });
  it("interval 경과 시 due", () => {
    const last = new Date("2026-06-15T08:30:00Z"); // 90분 전
    expect(isSyncDue(now, last, 60)).toBe(true);
  });
  it("interval 미경과 시 not due", () => {
    const last = new Date("2026-06-15T09:30:00Z"); // 30분 전
    expect(isSyncDue(now, last, 60)).toBe(false);
  });
  it("정확히 interval일 때 due(경계)", () => {
    const last = new Date("2026-06-15T09:00:00Z"); // 정확히 60분 전
    expect(isSyncDue(now, last, 60)).toBe(true);
  });
});

describe("isDigestDue", () => {
  const base = {
    nowKstHour: 9,
    digestHourKst: 8,
    todayKstDate: "2026-06-15",
    lastSentDate: null,
  };
  it("활성 + 시각 도달 + 미발송이면 due", () => {
    expect(isDigestDue({ enabled: true, ...base })).toBe(true);
  });
  it("비활성이면 not due", () => {
    expect(isDigestDue({ enabled: false, ...base })).toBe(false);
  });
  it("시각 미도달이면 not due", () => {
    expect(isDigestDue({ enabled: true, ...base, nowKstHour: 7 })).toBe(false);
  });
  it("오늘 이미 발송했으면 not due", () => {
    expect(
      isDigestDue({ enabled: true, ...base, lastSentDate: "2026-06-15" }),
    ).toBe(false);
  });
  it("어제 발송했으면 due", () => {
    expect(
      isDigestDue({ enabled: true, ...base, lastSentDate: "2026-06-14" }),
    ).toBe(true);
  });
});

describe("EMAIL_SETTINGS_DEFAULTS", () => {
  it("현재 하드코딩 값과 동일", () => {
    expect(EMAIL_SETTINGS_DEFAULTS.replyNeededLimit).toBe(5);
    expect(EMAIL_SETTINGS_DEFAULTS.importantLimit).toBe(10);
    expect(EMAIL_SETTINGS_DEFAULTS.windowDays).toBe(7);
    expect(EMAIL_SETTINGS_DEFAULTS.categories).toEqual([
      "money",
      "security",
      "schedule",
      "notice",
    ]);
  });
});
