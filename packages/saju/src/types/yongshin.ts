import type { Stem, Element } from "../hanja";
import type { ShenVerdict } from "../lib/shen-strength";

export interface KoYongshin {
  school: "ko";
  primary: Element;
  secondary?: Element;
  gisin: Element[];
  basisShenStrength: ShenVerdict;     // v0.3: 6값
  basisJohuMode: "한랭" | "조열" | "균형";
  rationale?: string;                 // v0.3 신규
}

export interface CnZipingYongshin {
  school: "cn-ziping";
  primary: Element;
  gisin: Element[];
  basisShenStrength: ShenVerdict;     // v0.3: 6값
  structureHint?: "식신생재" | "관인상생" | "기타";
  rationale?: string;                 // v0.3 신규
}

export interface CnMangpaiYongshin {
  school: "cn-mangpai";
  primary: Element;
  gisin: Element[];
  emergenceHint: string;
}

export interface JpYongshin {
  school: "jp";
  favorable: string[];
  unfavorable: string[];
}

export type Yongshin = KoYongshin | CnZipingYongshin | CnMangpaiYongshin | JpYongshin;

export interface ShenStrengthBasis {
  dayStem: Stem;
  monthBranch: string;
  supportScore: number;
  drainScore: number;
  verdict: ShenVerdict;               // v0.3: 6값
}
