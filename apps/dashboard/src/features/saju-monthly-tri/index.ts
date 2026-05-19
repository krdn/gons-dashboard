// saju-monthly-tri 슬라이스 public API.
//
// v0.3 Phase 3 (API 라우트) 기준 — server-side 헬퍼만 노출.
// Phase 6 (위젯) 에서 UI 컴포넌트가 추가되면 ui/ 도 함께 re-export 한다.
//
// FSD 의존성 방향: app(router) / widgets → features (이 파일) → entities → shared.
export {
  getOrBuildMonthly,
  MonthlyBuildError,
  ProfileNotFoundError,
  currentKstMonth,
  currentKstYear,
  type GetMonthlyResult,
} from "./api/monthly-server";
export {
  getOrBuildMonthlyNarrative,
  extractJsonObject,
  type NarrativeSchool,
  type MonthlyNarrativeResult,
} from "./api/narrative-server";
