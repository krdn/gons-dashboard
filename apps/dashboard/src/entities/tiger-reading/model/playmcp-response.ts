// PlayMCP 1FATE 응답 타입. 1차 호출(1967-03-29 / 1976-12-01) 결과 기반.
// spec §4.2 + 1차 호출 fixture + 운영 실측 (2026-05-16 PR #62 머지 후).
//
// 모든 _ko / _en / _ja 트리플은 다국어 narrative. 카드 표시는 _ko 우선.

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

export interface PlayMCPElementDetail {
  element: string;
  ko: string;
  en: string;
  ja: string;
}

export interface PlayMCPHealthDetails {
  balanced: boolean;
  excess: PlayMCPElementDetail[];
  lacking: PlayMCPElementDetail[];
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

// Yearly: 운영 호출 결과(2026 fortune)로 schema 확정.
export interface PlayMCPDaeunDetail {
  gapja: string;
  age_range_ko: string;
  age_range_en: string;
  age_range_ja: string;
  summary_ko: string;
  summary_en: string;
  summary_ja: string;
}

export interface PlayMCPYearlyResult {
  result: {
    profile: PlayMCPProfile;
    target_year: number;
    korean_age: number;
    grade_ko: string;
    grade_en: string;
    grade_ja: string;
    year_overview_ko: string;
    year_overview_en: string;
    year_overview_ja: string;
    key_themes_ko: string[];
    key_themes_en: string[];
    key_themes_ja: string[];
    opportunities_ko: string[];
    opportunities_en: string[];
    opportunities_ja: string[];
    cautions_ko: string[];
    cautions_en: string[];
    cautions_ja: string[];
    daeun_detail: PlayMCPDaeunDetail;
    one_line_ko: string;
    one_line_en: string;
    one_line_ja: string;
    suggested_narrative_ko: string;
    suggested_narrative_en: string;
    suggested_narrative_ja: string;
  };
}

// Daily: 현재 PlayMCP 서버 버그 (`name 'longitude' is not defined`)로 호출 시
// 항상 isError 반환. 운영 fix 대기. schema는 analyze와 유사 가정 유지.
export interface PlayMCPDailyResult {
  result: {
    profile: PlayMCPProfile;
    suggested_narrative_ko: string;
    suggested_narrative_en: string;
    suggested_narrative_ja: string;
    [key: string]: unknown;
  };
}

// Compatibility: 운영 cache 1 row (1976-12-01 ♀ × 1967-03-29 ♂)로 schema 확정.
export interface PlayMCPCompatibilityPerson {
  ilju: string;
  profile: string;
  trait_ko: string;
  trait_en: string;
  trait_ja: string;
  element_ko: string;
  element_en: string;
  element_ja: string;
  impression_ko: string;
  impression_en: string;
  impression_ja: string;
  nickname_full: string;
  nickname_short: string;
  nickname_short_ja: string;
}

export interface PlayMCPCompatTrigram {
  ko: string;
  en: string;
  ja: string;
}

export interface PlayMCPCompatibilityResult {
  result: {
    grade: string;
    grade_label_ko: string;
    grade_label_en: string;
    grade_label_ja: string;
    person1: PlayMCPCompatibilityPerson;
    person2: PlayMCPCompatibilityPerson;
    relation_type_ko: string;
    relation_type_en: string;
    relation_type_ja: string;
    relation_desc_ko: string;
    relation_desc_en: string;
    relation_desc_ja: string;
    chemistry_ko: string;
    chemistry_en: string;
    chemistry_ja: string;
    strengths: PlayMCPCompatTrigram[];
    cautions: PlayMCPCompatTrigram[];
    advice_ko: string;
    advice_en: string;
    advice_ja: string;
    summary_ko: string;
    summary_en: string;
    summary_ja: string;
    suggested_narrative_ko: string;
    suggested_narrative_en: string;
    suggested_narrative_ja: string;
  };
}
