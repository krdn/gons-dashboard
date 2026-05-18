// Phase 6 Task 6.1 — wrapper level canonical golden.
//
// compose/yearly.test.ts 는 chart 를 직접 주입하는 adapter level test.
// 본 파일은 buildTriNationYearlyFromBirth wrapper 의 전체 체인을 검증:
//   resolveTrueSolar → verifyConsensus → computeSajuChart → computeMajorFortunes
//   → buildTriNationYearly
//
// 회귀 보호: packages/saju 의 어떤 함수가 바뀌어도 1967-03-29 wrapper 출력의
// frames + crossCheck shape 가 그대로인지 snapshot 으로 byte-identical 검증.
//
// 시간 의존성 회피: currentAge 는 hardcoded 명시 인자. resolveTrueSolar /
// verifyConsensus / computeSajuChart 모두 birthDateLocal/birthTimeLocal 만
// 사용 (Date.now() 호출 없음, advisor 확인 완료).
//
// 1967-03-29 05:30 KST — G1 일주 (壬辰).
// memory `saju-G1-day-pillar-correction` 참조 (PlayMCP 분석은 틀렸음, 두 라이브러리 합의는 壬辰).
import { describe, expect, it } from "vitest";
import { buildTriNationYearlyFromBirth } from "./yearly";
import type { BirthInputResolved } from "./lifetime";

const canonical1967Input: BirthInputResolved = {
  birthDateLocal: "1967-03-29",
  birthTimeLocal: "05:30",
  timezone: "Asia/Seoul",
  longitudeDeg: 127,
  calendar: "solar",
  gender: "male",
};

describe("buildTriNationYearlyFromBirth — 1967-03-29 canonical golden", () => {
  it("2026 세운 wrapper 출력 snapshot 일치", () => {
    const result = buildTriNationYearlyFromBirth({
      input: canonical1967Input,
      targetYear: 2026,
      currentAge: 59,
    });

    if (!result.ok) {
      throw new Error(`expected ok=true, got error: ${result.error.code} ${result.error.message}`);
    }

    expect(result.value).toMatchSnapshot();
  });

  it("targetYear=2025 도 snapshot 일치", () => {
    const result = buildTriNationYearlyFromBirth({
      input: canonical1967Input,
      targetYear: 2025,
      currentAge: 58,
    });

    if (!result.ok) {
      throw new Error(`expected ok=true, got error: ${result.error.code} ${result.error.message}`);
    }

    expect(result.value).toMatchSnapshot();
  });
});
