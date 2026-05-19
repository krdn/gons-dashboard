// Saju 삼국 분석 v0.3 — 월운(月運) 프레임 타입.
//
// 정책: YearlyFrame (types/yearly.ts) 를 그대로 미러링하고 (a) targetMonth 추가,
// (b) yearGanji → monthGanji 치환. spec §3.2 의 단순화된 schema (yongShinDelta:
// netVerdict+details, interpretationHints: string[]) 는 D6 "단순화는 일진 한정" 와
// 모순이라 채택하지 않는다 — Yearly 와 동일 구조로 LLM narrative 입력 일관성 유지.
//
// daeunTransition 의미: 월운에서도 yearly 와 같은 로직 (nextDaeun.startAge === currentAge+1).
// 월운 자체는 1달짜리라 "이 달에 transition" 의미는 약하지만, "이 달이 속한 해에
// 대운 전환이 임박" 정도의 컨텍스트로 LLM 에 전달된다.
import type { Stem, Branch, Element } from "../hanja";
import type { Yongshin } from "./yongshin";

export interface MonthlyFrame {
  school: "ko" | "cn-ziping" | "cn-mangpai" | "jp";
  targetYear: number;
  targetMonth: number; // 1..12 (KST 양력 기준)

  monthGanji: { stem: Stem; branch: Branch };

  currentDaeun: {
    startAge: number;
    endAge: number;
    ganji: { stem: Stem; branch: Branch };
  };

  daeunTransition: {
    willTransitionAt: number;
    nextGanji: { stem: Stem; branch: Branch };
  } | null;

  ganjiInteractions: {
    type: "충" | "합" | "형" | "파" | "해";
    subject: { pillar: "year" | "month" | "day" | "hour"; element: Stem | Branch };
    object: Stem | Branch;
  }[];

  yongShinDelta: {
    reinforced: Element[];
    weakened: Element[];
    netVerdict: "favorable" | "unfavorable" | "mixed";
  };

  schoolSpecificHints: Record<string, string>;

  shensha: { name: string; pillar: string }[];

  yongShinUsed: Yongshin;
}

export interface TriNationMonthly {
  targetYear: number;
  targetMonth: number;
  frames: {
    ko: MonthlyFrame;
    cnZiping: MonthlyFrame;
    cnMangpai: MonthlyFrame;
    jp: MonthlyFrame;
  };
  crossCheck: {
    agreement: "high" | "medium" | "low";
    notes: string[];
  };
}
