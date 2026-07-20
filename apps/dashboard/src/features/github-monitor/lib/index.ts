// 판정 순수 함수 재export — 소비자가 개별 파일 경로를 몰라도 되게 한다.
//
// features/github-monitor/index.ts(server entrypoint)와 분리한 이유:
// 이 함수들은 DB·네트워크 의존이 없어 fetch/postgres 를 끌어오지 않는다.
//
// ⚠️ 다만 "client 안전"은 아니다. normalizeRunOutcome 이 shared/lib/log 를
// import 하고 그 모듈은 `import "server-only"` 다. 따라서 이 배럴은
// **서버 트리 전용**(RSC·API route·cron·서버 렌더 위젯)이다.
// "use client" 컴포넌트에서 판정이 필요해지면 logger 의존을 걷어내거나
// client 전용 변형을 따로 두어야 한다.
export { normalizeRunOutcome, type RunOutcome } from "./normalizeRunOutcome";
export { judgeBuildState } from "./judgeBuildState";
export { derivePrCiStatus } from "./derivePrCiStatus";
export { isPrStale, isIssueTriageStale, deriveSyncDisplayState } from "./judgeStaleness";
