// saju-daily-tri 슬라이스 public API.
//
// v0.3 Phase 5 — server-side 헬퍼만 노출 (cron route + Phase 6 위젯 용도).
// Phase 6 (위젯) 에서 UI 컴포넌트가 추가되면 ui/ 도 함께 re-export 한다.
export {
  getOrBuildDaily,
  DailyBuildError,
  ProfileNotFoundError,
  kstTodayDate,
  type GetDailyResult,
} from "./api/daily-server";
export {
  getOrBuildDailyNarrative,
  type NarrativeSchool,
  type DailyNarrativeResult,
} from "./api/narrative-server";
