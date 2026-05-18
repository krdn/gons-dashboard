// saju-yearly-tri 슬라이스 public API.
//
// v0.2 Phase 4 (API 라우트) 기준 — server-side 헬퍼만 노출.
// Phase 5 (위젯) 에서 UI 컴포넌트가 추가되면 ui/ 도 함께 re-export 한다.
//
// FSD 의존성 방향: app(router) / widgets → features (이 파일) → entities → shared.
export {
  getOrBuildYearly,
  YearlyBuildError,
  ProfileNotFoundError,
  currentKstYear,
  currentKstAge,
  type GetYearlyResult,
} from "./api/yearly-server";
export {
  getOrBuildYearlyNarrative,
  extractJsonObject,
  type NarrativeSchool,
  type YearlyNarrativeResult,
} from "./api/narrative-server";
