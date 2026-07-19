import { describe, it, expect } from "vitest";
import { judgeHttp, judgeSsl } from "./judgeAvailability";

describe("judgeHttp — 3연속 실패 판정", () => {
  it("성공 → ok (직전 이력 무관)", () => {
    expect(judgeHttp(true, [])).toBe("ok");
    expect(judgeHttp(true, ["critical", "critical"])).toBe("ok");
  });

  it("첫/두 번째 실패 → warning", () => {
    expect(judgeHttp(false, [])).toBe("warning");
    expect(judgeHttp(false, ["ok", "ok"])).toBe("warning");
    expect(judgeHttp(false, ["warning", "ok"])).toBe("warning");
  });

  it("3연속 실패 → critical, 이후 실패 지속 시 critical 유지", () => {
    expect(judgeHttp(false, ["warning", "warning"])).toBe("critical");
    expect(judgeHttp(false, ["critical", "critical"])).toBe("critical");
  });

  it("사이에 ok 가 끼면 streak 리셋", () => {
    expect(judgeHttp(false, ["ok", "warning"])).toBe("warning");
  });
});

describe("judgeSsl — D-day 경계", () => {
  it("D-7 이하 critical / D-14 이하 warning / 그 외 ok", () => {
    expect(judgeSsl(7)).toBe("critical");
    expect(judgeSsl(8)).toBe("warning");
    expect(judgeSsl(14)).toBe("warning");
    expect(judgeSsl(15)).toBe("ok");
  });
});
