// widgets/memo-insights — server entrypoint (RSC 전용). 순수 집계 함수 re-export.
// RSC 페이지는 이 경로로만 집계 함수를 import한다 (deep import 금지, spec §7).
export {
  buildActivityHeatmap,
  buildDailyTrend,
  buildCategoryDistribution,
  buildActionConversion,
  buildDigestTimeline,
} from "./lib/aggregate";
export type {
  ActivityHeatmap,
  DailyTrendPoint,
  CategoryDistribution,
  ActionConversion,
  DigestTimelinePoint,
  DayCell,
} from "./model/types";
