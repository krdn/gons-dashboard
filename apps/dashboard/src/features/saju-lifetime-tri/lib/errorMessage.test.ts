// 공통 매핑·PREFIX·fallback 의 전수 검증은 shared/lib/saju/errorMessage.test.ts 에 있다.
// 여기서는 lifetime slice 가 공통 매핑을 그대로 노출하는지(고유 키 없음)만 가볍게 확인.
import { describe, expect, it } from "vitest";
import { toUserMessage } from "./errorMessage";

describe("lifetime toUserMessage — 공통 매핑 위임", () => {
  it("공통 EXACT 코드를 그대로 노출", () => {
    expect(toUserMessage("Unauthorized")).toBe("로그인이 필요합니다.");
    expect(toUserMessage("INVALID_SCHOOL")).toBe("잘못된 학파 요청입니다.");
  });

  it("PREFIX 디버그 컨텍스트 보존", () => {
    expect(toUserMessage("INVALID_CALENDAR: bogus")).toBe(
      "프로필 달력 형식이 올바르지 않습니다 (bogus)",
    );
  });

  it("LifetimeBuildError 의 임의 message 는 fallback 원본 노출", () => {
    expect(toUserMessage("만세력 합의 실패: ko vs jp")).toBe(
      "분석에 실패했습니다: 만세력 합의 실패: ko vs jp",
    );
  });

  it("null → 알 수 없는 오류", () => {
    expect(toUserMessage(null)).toBe("알 수 없는 오류가 발생했습니다.");
  });
});
