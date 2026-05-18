import type { Stem, Element } from "../hanja";

export interface KoYongshin {
  school: "ko";
  primary: Element;
  secondary?: Element;
  gisin: Element[];
  basisShenStrength: "신강" | "신약" | "균형";
  basisJohuMode: "한랭" | "조열" | "균형";
}

export interface CnZipingYongshin {
  school: "cn-ziping";
  primary: Element;
  gisin: Element[];
  basisShenStrength: "신강" | "신약" | "균형";
  structureHint?: "식신생재" | "관인상생" | "기타";
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

export type Yongshin =
  | KoYongshin
  | CnZipingYongshin
  | CnMangpaiYongshin
  | JpYongshin;

export interface ShenStrengthBasis {
  dayStem: Stem;
  monthBranch: string;
  supportScore: number;
  drainScore: number;
  verdict: "신강" | "신약" | "균형";
}
