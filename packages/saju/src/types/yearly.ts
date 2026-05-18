import type { Stem, Branch, Element } from "../hanja";
import type { Yongshin } from "./yongshin";

export interface YearlyFrame {
  school: "ko" | "cn-ziping" | "cn-mangpai" | "jp";
  targetYear: number;

  yearGanji: { stem: Stem; branch: Branch };

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

export interface TriNationYearly {
  targetYear: number;
  frames: {
    ko: YearlyFrame;
    cnZiping: YearlyFrame;
    cnMangpai: YearlyFrame;
    jp: YearlyFrame;
  };
  crossCheck: {
    agreement: "high" | "medium" | "low";
    notes: string[];
  };
}
