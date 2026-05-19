// Saju 삼국 분석 v0.3 — tri 일진(日辰) 단순화 프레임 타입.
//
// spec D6: "tri 일진 분석 심도 = 간지 대 용신 충합 (YearlyFrame 대비 단순화)" — daily 에
// 한해 단순화 적용. yearly/monthly 와 달리 currentDaeun/ganjiInteractions/yongShinDelta
// /shensha 모두 제거하고 `dayGanji + dayVibe + hints` 3개로 압축.
//
// LLM narrative 가 일진 (1일 단위) 마다 호출되는 비용 부담을 고려해 frame 자체를
// 가볍게 유지. 보다 정밀한 분석이 필요해지면 v0.4 에서 확장 frame 분리 고려.
import type { Stem, Branch } from "../hanja";

export interface DailyLiteFrame {
  school: "ko" | "cn-ziping" | "cn-mangpai" | "jp";
  /** 양력 날짜 (YYYY-MM-DD), KST. */
  forDate: string;

  /** 일진 간지. computeDayPillar(forDate) 결과. */
  dayGanji: { stem: Stem; branch: Branch };

  /** 학파별 일진 평가 — 단순 3분류. */
  dayVibe: "auspicious" | "inauspicious" | "neutral";

  /** LLM narrative 프롬프트용 학파별 해석 힌트 (1-3 문장 권장). */
  hints: string[];
}

export interface TriNationDailyLite {
  forDate: string;
  frames: {
    ko: DailyLiteFrame;
    cnZiping: DailyLiteFrame;
    cnMangpai: DailyLiteFrame;
    jp: DailyLiteFrame;
  };
  /**
   * 4학파 dayVibe 의 합의 — 3/4 학파 이상이 같으면 그 값, 아니면 neutral.
   * UI 의 day badge 색상 / fortune page 권고 톤에 사용.
   */
  overallVibe: "auspicious" | "inauspicious" | "neutral";
}
