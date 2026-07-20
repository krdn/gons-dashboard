// GitHub 관제 임계값·상한 — 이슈 #323.
// features/monitoring-datastore/config/thresholds.ts 의 미러 구조.
//
// 매직 넘버를 판정 함수에 흩뿌리지 않고 여기 모은다 — 임계값 조정이
// 판정 로직 수정과 섞이지 않게 하기 위함이다.

/** 감시 대상 org. env GITHUB_MONITOR_ORG 로 덮어쓸 수 있다. */
export const GITHUB_ORG_DEFAULT = "krdn";

/** 배포 파이프라인 판정 대상 레포 — 활성 레포 필터와 무관하게 항상 수집한다. */
export const BUILD_REPO = "krdn/gons-dashboard";

/**
 * Build 워크플로의 안정 식별자 (파일 경로).
 * ⚠️ 이름(`name:`)이 아니라 경로를 쓴다 — 이름은 변경돼도 경로는 유지된다.
 * 실제 워크플로 파일이 바뀌면 여기를 갱신한다.
 */
export const BUILD_WORKFLOW_PATH = ".github/workflows/ci.yml";

/**
 * main HEAD 커밋 후 이 시간 안에는 run 이 없어도 no-run 으로 판정하지 않는다.
 * push 직후 워크플로 등록까지의 정상 공백을 오탐으로 만들지 않기 위함.
 */
export const NO_RUN_GRACE_MS = 10 * 60_000;

/** PR 정체 경고 임계 (draft 제외). */
export const PR_STALE_MS = 7 * 24 * 60 * 60_000;

/** needs-triage 이슈 정체 경고 임계. */
export const ISSUE_TRIAGE_STALE_MS = 14 * 24 * 60 * 60_000;

/** 이 라벨이 붙은 이슈만 triage 정체 판정 대상. */
export const TRIAGE_LABEL = "needs-triage";

/** 마지막 성공이 이보다 오래되면 보드에 stale 배지. 5분 주기의 3배 여유. */
export const SYNC_STALE_MS = 15 * 60_000;

/** Actions 수집 대상: 이 기간 안에 push 가 있었던 레포. */
export const ACTIVE_REPO_WINDOW_MS = 7 * 24 * 60 * 60_000;

/** Search API 페이지 상한 (100건/페이지). 초과분은 보드에서 GitHub 링크로 위임. */
export const SEARCH_MAX_PAGES = 2;

/** 레포당 보관·조회할 workflow run 수. */
export const RUNS_PER_REPO = 20;

/** PR HEAD sha 를 별도 조회할 최대 PR 수. 초과분은 CI 상태 unknown. */
export const PR_HEAD_FETCH_LIMIT = 20;

/** org repos 목록 페이지 상한. */
export const REPO_LIST_MAX_PAGES = 2;
