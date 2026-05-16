// PlayMCP 1FATE 응답 타입. 1차 호출(1967-03-29 / 1976-12-01) 결과 기반.
// spec §4.2 + 1차 호출 fixture 참조.

export interface PlayMCPProfile {
  nickname_full: string;
  nickname_short: string;
  nickname_short_ja: string;
}

export interface PlayMCPPersonality {
  first_impression_ko: string;
  first_impression_en: string;
  first_impression_ja: string;
  core_trait_ko: string;
  core_trait_en: string;
  core_trait_ja: string;
  strengths_ko: string;
  strengths_en: string;
  strengths_ja: string;
}

export interface PlayMCPHealthDetails {
  balanced: boolean;
  excess: Array<{ element: string; ko: string; en: string; ja: string }>;
  lacking: Array<{ element: string; ko: string; en: string; ja: string }>;
}

export interface PlayMCPLifeHints {
  career_ko: string;
  career_en: string;
  career_ja: string;
  relationship_ko: string;
  relationship_en: string;
  relationship_ja: string;
  health_summary_ko: string;
  health_summary_en: string;
  health_summary_ja: string;
  health_details: PlayMCPHealthDetails;
}

export interface PlayMCPAnalysisResult {
  result: {
    profile: PlayMCPProfile;
    type_summary_ko: string;
    type_summary_en: string;
    type_summary_ja: string;
    personality: PlayMCPPersonality;
    element_tendency_ko: string;
    element_tendency_en: string;
    element_tendency_ja: string;
    supplement_hint_ko: string;
    supplement_hint_en: string;
    supplement_hint_ja: string;
    life_hints: PlayMCPLifeHints;
    suggested_narrative_ko: string;
    suggested_narrative_en: string;
    suggested_narrative_ja: string;
  };
  powered_by?: string;
  _build?: string;
}

// year/daily/compat 응답: 실호출로 형태 확정 필요 (구현 단계 Task 4.x 에서 fixture 채취).
// 우선 analyze 와 동일 모양으로 가정 — narrative 위주.
export interface PlayMCPYearlyResult {
  result: {
    profile: PlayMCPProfile;
    suggested_narrative_ko: string;
    suggested_narrative_en: string;
    suggested_narrative_ja: string;
    [key: string]: unknown;
  };
}

export interface PlayMCPDailyResult {
  result: {
    profile: PlayMCPProfile;
    suggested_narrative_ko: string;
    suggested_narrative_en: string;
    suggested_narrative_ja: string;
    [key: string]: unknown;
  };
}

export interface PlayMCPCompatibilityResult {
  result: {
    profile1: PlayMCPProfile;
    profile2: PlayMCPProfile;
    suggested_narrative_ko: string;
    suggested_narrative_en: string;
    suggested_narrative_ja: string;
    [key: string]: unknown;
  };
}
