import type {
  PlayMCPAnalysisResult,
  PlayMCPCompatibilityResult,
} from "@/entities/tiger-reading";

export type ValidationResult = { ok: true } | { ok: false; reason: string };

interface ProfileForValidation {
  id: string;
  nickname: string;
  birthDate: string;
  gender: "male" | "female";
}

// in-memory LRU(20). 컨테이너 재시작 시 리셋. cross-talk 은 짧은 시간 창 안의
// 연속 호출에서 발생하므로 메모리 LRU 로 충분 (spec §6.1 Check 4).
const LRU_MAX = 20;
const recentNicknames = new Map<string, string>();

function rememberNickname(nickname: string, profileId: string): void {
  recentNicknames.delete(nickname);
  recentNicknames.set(nickname, profileId);
  if (recentNicknames.size > LRU_MAX) {
    const oldestKey = recentNicknames.keys().next().value;
    if (oldestKey) recentNicknames.delete(oldestKey);
  }
}

/** 테스트 전용. production 코드에서 호출 금지. */
export function _resetRecentNicknames(): void {
  recentNicknames.clear();
}

function dateFormats(birthDate: string): string[] {
  return [
    birthDate,                           // '1967-03-29'
    birthDate.replace(/-/g, "."),        // '1967.03.29' (PlayMCP 1차 실증 포맷)
    birthDate.replace(/-/g, "/"),        // '1967/03/29'
  ];
}

export function validateAnalysisResponse(
  response: PlayMCPAnalysisResult,
  profile: ProfileForValidation,
): ValidationResult {
  const nick = response?.result?.profile?.nickname_full ?? "";
  const nickShort = response?.result?.profile?.nickname_short ?? "";
  const narrative = response?.result?.suggested_narrative_ko ?? "";

  // Check 1
  if (!dateFormats(profile.birthDate).some((f) => nick.includes(f))) {
    return { ok: false, reason: "birth_date_missing_in_nickname" };
  }
  // Check 2
  const genderKo = profile.gender === "male" ? "남자" : "여자";
  if (!nick.includes(genderKo)) {
    return { ok: false, reason: "gender_mismatch" };
  }
  // Check 3 — narrative 가 있을 때만 검사 (fixture 가 짧을 수 있음)
  if (narrative) {
    const paragraphs = narrative.split("\n\n");
    const firstSubstantive = paragraphs[1] ?? paragraphs[0] ?? "";
    if (nickShort && firstSubstantive && !firstSubstantive.includes(nickShort)) {
      return { ok: false, reason: "narrative_nickname_inconsistent" };
    }
  }
  // Check 4
  const owner = recentNicknames.get(nick);
  if (owner && owner !== profile.id) {
    return { ok: false, reason: "duplicate_nickname_different_profile" };
  }
  rememberNickname(nick, profile.id);
  return { ok: true };
}

export function validateYearlyResponse(
  response: { result: { profile?: { nickname_full?: string }; suggested_narrative_ko?: string } },
  profile: ProfileForValidation,
): ValidationResult {
  // year 응답도 profile 필드를 가정. analyze 와 동일 검사.
  return validateAnalysisResponse(response as PlayMCPAnalysisResult, profile);
}

export function validateDailyResponse(
  response: { result: { profile?: { nickname_full?: string }; suggested_narrative_ko?: string } },
  profile: ProfileForValidation,
): ValidationResult {
  return validateAnalysisResponse(response as PlayMCPAnalysisResult, profile);
}

export function validateCompatibilityResponse(
  response: PlayMCPCompatibilityResult,
  p1: ProfileForValidation,
  p2: ProfileForValidation,
): ValidationResult {
  const narrative = response?.result?.suggested_narrative_ko ?? "";
  const has1 = dateFormats(p1.birthDate).some((f) => narrative.includes(f));
  const has2 = dateFormats(p2.birthDate).some((f) => narrative.includes(f));
  if (!has1 || !has2) {
    return { ok: false, reason: "compatibility_one_side_missing" };
  }
  return { ok: true };
}
