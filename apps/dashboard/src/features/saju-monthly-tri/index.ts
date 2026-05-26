// saju-monthly-tri 슬라이스 public API.
//
// v0.3.1 Phase 6 에서 UI (TriMonthlyTabs / MonthlyFrameView / MonthlyCrossCheckBadge)
// 가 추가됐다. 위젯과 app router 가 이 barrel 을 통해 import.
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
  type NarrativeSchool,
  type MonthlyNarrativeResult,
} from "./api/narrative-server";
export { MonthlyCrossCheckBadge } from "./ui/MonthlyCrossCheckBadge";
export { TriMonthlyTabs } from "./ui/TriMonthlyTabs";
export {
  MonthlyFrameView,
  type MonthlyNarrativePayload,
} from "./ui/MonthlyFrameView";
