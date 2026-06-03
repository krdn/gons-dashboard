// 사주 narrative 타입 — @krdn/saju 패키지에서 import + re-export.
// DB 테이블의 $type<...>() 참조가 로컬 identifier 를 사용하므로 import 필수.
import type {
  NarrativeSchool as _NarrativeSchool,
  NarrativeKeyTerm as _NarrativeKeyTerm,
  LifetimeNarrativeSections as _LifetimeNarrativeSections,
  YearlyNarrativeSections as _YearlyNarrativeSections,
  MonthlyNarrativeSections as _MonthlyNarrativeSections,
  SchoolSpecificKo as _SchoolSpecificKo,
  SchoolSpecificZiping as _SchoolSpecificZiping,
  SchoolSpecificMangpai as _SchoolSpecificMangpai,
  SchoolSpecificJp as _SchoolSpecificJp,
  SchoolSpecific as _SchoolSpecific,
} from "@krdn/saju";

export type NarrativeSchool = _NarrativeSchool;
export type NarrativeKeyTerm = _NarrativeKeyTerm;
export type LifetimeNarrativeSections = _LifetimeNarrativeSections;
export type YearlyNarrativeSections = _YearlyNarrativeSections;
export type MonthlyNarrativeSections = _MonthlyNarrativeSections;
export type SchoolSpecificKo = _SchoolSpecificKo;
export type SchoolSpecificZiping = _SchoolSpecificZiping;
export type SchoolSpecificMangpai = _SchoolSpecificMangpai;
export type SchoolSpecificJp = _SchoolSpecificJp;
export type SchoolSpecific = _SchoolSpecific;

/** @deprecated YearlyNarrativeSections 를 직접 사용하세요 (하위호환 alias) */
export type NarrativeSections = YearlyNarrativeSections;
