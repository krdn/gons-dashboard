import { describe, expect, it } from "vitest";
import { toUserMessage } from "./errorMessage";

describe("toUserMessage — 공통 EXACT", () => {
  it("Unauthorized → 로그인 안내", () => {
    expect(toUserMessage("Unauthorized")).toBe("로그인이 필요합니다.");
  });

  it("PROFILE_NOT_FOUND → 프로필 안내", () => {
    expect(toUserMessage("PROFILE_NOT_FOUND")).toBe("프로필을 찾을 수 없습니다.");
  });

  it("INVALID_SCHOOL → 잘못된 학파 안내", () => {
    expect(toUserMessage("INVALID_SCHOOL")).toBe("잘못된 학파 요청입니다.");
  });

  it("RATE_LIMIT → 한도 초과 안내", () => {
    expect(toUserMessage("RATE_LIMIT")).toBe(
      "잠시 후 다시 시도해주세요 (분당 요청 한도 초과).",
    );
  });

  it("INTERNAL_ERROR → 일시 장애 안내", () => {
    expect(toUserMessage("INTERNAL_ERROR")).toBe(
      "분석 중 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.",
    );
  });
});

describe("toUserMessage — slice 고유 EXACT 주입", () => {
  const dailyMap = { INVALID_DATE: "잘못된 날짜 요청입니다 (YYYY-MM-DD 형식)." };
  const monthlyMap = {
    INVALID_YEAR: "잘못된 연도 요청입니다 (1900~2100 범위 외).",
    INVALID_MONTH: "잘못된 월 요청입니다 (1~12 범위 외).",
  };

  it("slice 키(INVALID_DATE) 가 주입되면 그 문구를 쓴다", () => {
    expect(toUserMessage("INVALID_DATE", dailyMap)).toBe(
      "잘못된 날짜 요청입니다 (YYYY-MM-DD 형식).",
    );
  });

  it("slice 키(INVALID_MONTH) 도 주입되면 매칭", () => {
    expect(toUserMessage("INVALID_MONTH", monthlyMap)).toBe(
      "잘못된 월 요청입니다 (1~12 범위 외).",
    );
  });

  it("slice 키와 무관한 공통 코드는 sliceMap 이 있어도 공통 문구", () => {
    expect(toUserMessage("Unauthorized", dailyMap)).toBe("로그인이 필요합니다.");
  });

  it("slice 키가 공통 키와 충돌하면 slice 가 우선", () => {
    expect(toUserMessage("INVALID_SCHOOL", { INVALID_SCHOOL: "override" })).toBe(
      "override",
    );
  });

  it("sliceMap 미제공(공통만) 시 slice 키는 fallback 으로 빠진다", () => {
    expect(toUserMessage("INVALID_DATE")).toBe(
      "분석에 실패했습니다: INVALID_DATE",
    );
  });
});

describe("toUserMessage — PREFIX_MAP (디버그 컨텍스트 보존)", () => {
  it("INVALID_CALENDAR:<값> → 달력 안내 + 값 괄호 보존", () => {
    expect(toUserMessage("INVALID_CALENDAR: bogus")).toBe(
      "프로필 달력 형식이 올바르지 않습니다 (bogus)",
    );
  });

  it("INVALID_CALENDAR: (값 빈 경우) → 마침표만", () => {
    expect(toUserMessage("INVALID_CALENDAR:")).toBe(
      "프로필 달력 형식이 올바르지 않습니다.",
    );
  });

  it("INVALID_GENDER:<값> → 성별 안내 + 값 보존", () => {
    expect(toUserMessage("INVALID_GENDER: other")).toBe(
      "프로필 성별 정보가 올바르지 않습니다 (other)",
    );
  });

  it("값 앞뒤 공백은 trim", () => {
    expect(toUserMessage("INVALID_CALENDAR:   solar2   ")).toBe(
      "프로필 달력 형식이 올바르지 않습니다 (solar2)",
    );
  });
});

describe("toUserMessage — Unknown / fallback", () => {
  it("EXACT 도 PREFIX 도 매칭 안 되면 generic + 원본 노출", () => {
    expect(toUserMessage("만세력 합의 실패: ko vs jp")).toBe(
      "분석에 실패했습니다: 만세력 합의 실패: ko vs jp",
    );
  });

  it("LifetimeBuildError 의 임의 message 도 원본 노출", () => {
    expect(toUserMessage("DAEUN_COMPUTATION_FAILED")).toBe(
      "분석에 실패했습니다: DAEUN_COMPUTATION_FAILED",
    );
  });
});

describe("toUserMessage — null / undefined / empty", () => {
  it("null → 알 수 없는 오류", () => {
    expect(toUserMessage(null)).toBe("알 수 없는 오류가 발생했습니다.");
  });

  it("undefined → 알 수 없는 오류", () => {
    expect(toUserMessage(undefined)).toBe("알 수 없는 오류가 발생했습니다.");
  });

  it("빈 문자열 → 알 수 없는 오류", () => {
    expect(toUserMessage("")).toBe("알 수 없는 오류가 발생했습니다.");
  });
});
