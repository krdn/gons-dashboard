import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateAnalysisResponse, validateCompatibilityResponse, _resetRecentNicknames } from "./validate";

const fix1967 = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../tests/playmcp-fixtures/analyze-1967-03-29-male.json"), "utf8"),
);
const fix1976 = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../tests/playmcp-fixtures/analyze-1976-12-01-male-cross-talk.json"), "utf8"),
);

const profile1967 = {
  id: "profile-1967",
  nickname: "본인",
  birthDate: "1967-03-29",
  gender: "male" as const,
};
const profile1976 = {
  id: "profile-1976",
  nickname: "친구",
  birthDate: "1976-12-01",
  gender: "male" as const,
};

beforeEach(() => _resetRecentNicknames());

describe("validateAnalysisResponse — Check 1 (birth_date)", () => {
  it("정상: nickname_full 에 1967.03.29 포함 → ok", () => {
    expect(validateAnalysisResponse(fix1967, profile1967)).toEqual({ ok: true });
  });

  it("실패: nickname_full 에 birth_date 미포함", () => {
    const bad = {
      ...fix1967,
      result: {
        ...fix1967.result,
        profile: { ...fix1967.result.profile, nickname_full: "이름만 있고 날짜 없음 (남자)" },
      },
    };
    expect(validateAnalysisResponse(bad, profile1967)).toEqual({
      ok: false,
      reason: "birth_date_missing_in_nickname",
    });
  });
});

describe("validateAnalysisResponse — Check 2 (gender)", () => {
  it("실패: 남자 프로필인데 nickname 에 '여자'", () => {
    const bad = {
      ...fix1967,
      result: {
        ...fix1967.result,
        profile: { ...fix1967.result.profile, nickname_full: "X (1967.03.29, 양력, 여자)" },
      },
    };
    expect(validateAnalysisResponse(bad, profile1967)).toEqual({
      ok: false,
      reason: "gender_mismatch",
    });
  });
});

describe("validateAnalysisResponse — Check 4 (LRU)", () => {
  it("같은 nickname 이 다른 profileId 로 들어오면 실패", () => {
    expect(validateAnalysisResponse(fix1967, profile1967)).toEqual({ ok: true });
    const result = validateAnalysisResponse(fix1967, { ...profile1967, id: "different-profile" });
    expect(result).toEqual({ ok: false, reason: "duplicate_nickname_different_profile" });
  });

  it("같은 nickname + 같은 profileId 는 통과 (재호출 시 정상)", () => {
    expect(validateAnalysisResponse(fix1967, profile1967)).toEqual({ ok: true });
    expect(validateAnalysisResponse(fix1967, profile1967)).toEqual({ ok: true });
  });
});

describe("validateCompatibilityResponse", () => {
  it("실패: narrative 에 한 쪽 birth_date 만 포함", () => {
    const compatResp = {
      result: {
        profile1: fix1967.result.profile,
        profile2: fix1976.result.profile,
        suggested_narrative_ko: "1967.03.29 에 관한 이야기만 있고 1976 은 빠짐",
        suggested_narrative_en: "",
        suggested_narrative_ja: "",
      },
    };
    expect(validateCompatibilityResponse(compatResp, profile1967, profile1976)).toEqual({
      ok: false,
      reason: "compatibility_one_side_missing",
    });
  });

  it("통과: 두 birth_date 모두 narrative 에 포함", () => {
    const compatResp = {
      result: {
        profile1: fix1967.result.profile,
        profile2: fix1976.result.profile,
        suggested_narrative_ko: "1967.03.29 분과 1976.12.01 분의 인연...",
        suggested_narrative_en: "",
        suggested_narrative_ja: "",
      },
    };
    expect(validateCompatibilityResponse(compatResp, profile1967, profile1976)).toEqual({ ok: true });
  });
});
