import { describe, expect, it } from "vitest";
import { resolveTrueSolar } from "./trueSolar";

describe("resolveTrueSolar", () => {
  it("부천(126.78°E) KST 05:30 → 약 -32분 보정", () => {
    const result = resolveTrueSolar({
      birthDateLocal: "1967-03-29",
      birthTimeLocal: "05:30",
      timezone: "Asia/Seoul",
      longitudeDeg: 126.78,
      calendar: "solar",
      gender: "male",
    });
    expect(result.trueSolarMinutesOffset).toBeGreaterThanOrEqual(-34);
    expect(result.trueSolarMinutesOffset).toBeLessThanOrEqual(-30);
    expect(result.hourKnown).toBe(true);
  });

  it("도쿄(139.69°E) JST 12:00 → 약 +19분", () => {
    const result = resolveTrueSolar({
      birthDateLocal: "2000-01-01",
      birthTimeLocal: "12:00",
      timezone: "Asia/Tokyo",
      longitudeDeg: 139.69,
      calendar: "solar",
      gender: "male",
    });
    expect(result.trueSolarMinutesOffset).toBeGreaterThanOrEqual(17);
    expect(result.trueSolarMinutesOffset).toBeLessThanOrEqual(21);
  });

  it("birthTimeLocal 빈 문자열 → hourKnown=false", () => {
    const result = resolveTrueSolar({
      birthDateLocal: "1967-03-29",
      birthTimeLocal: "",
      timezone: "Asia/Seoul",
      longitudeDeg: 126.78,
      calendar: "solar",
      gender: "male",
    });
    expect(result.hourKnown).toBe(false);
  });

  it("진태양시가 시주 경계 +5분 이내 접근 → candidateBranches=[current,next]", () => {
    // Seoul 13:30 + 126.78°E:
    //   minutesOffset = round((126.78 - 135) * 4) = -33
    //   wallClock UTC = 04:30, trueSolar UTC = 03:57
    //   trueSolarLocalMinutes = (3*60 + 57 + 540) % 1440 = 777
    //   cycleOffset = (777 + 60) % 120 = 117 → ambiguous (≥ 115)
    //   branchIdx = floor(837 / 120) = 6 → 午
    //   cycleOffset > 5 → prev=午, next=未
    const result = resolveTrueSolar({
      birthDateLocal: "2000-01-01",
      birthTimeLocal: "13:30",
      timezone: "Asia/Seoul",
      longitudeDeg: 126.78,
      calendar: "solar",
      gender: "male",
    });
    expect(result.ambiguityWindow).toBeDefined();
    expect(result.ambiguityWindow?.candidateBranches).toEqual(["午", "未"]);
  });
});
