# GitHub 관제 — 이슈·PR·Actions 통합 보드 설계

- 날짜: 2026-07-20
- 상태: 설계 확정
- 관련: 이슈 #323 (실시간 관제), 메모리 `ci-build-not-equals-deploy`

## 1. 목적

krdn org 레포들의 **미완결 작업**(열린 이슈·PR·실패한 Actions)을 기존 관제 보드와
같은 화면 계열에서 5초 안에 판단할 수 있게 한다.

핵심 가치는 단순 목록 나열이 아니라 **`build-failed` 감지**다. main 에 머지했는데
GHA Build 가 실패하면 ghcr 에 새 이미지가 올라가지 않고, deploy-watcher 는
"변화 없음"으로 조용히 판단한다. 지금은 이 상태를 사람이 `gh run list` 로 직접
확인해야만 알 수 있다. 이 갭이 메모리 `ci-build-not-equals-deploy` 함정의 원인이다.

## 2. 범위

### 포함
- krdn org 전체 레포의 열린 이슈 / 열린 PR / 최근 workflow run
- gons-dashboard 의 main HEAD ↔ Build 상태 판정
- critical 상태의 `monitoring_events` 발행 (기존 텔레그램·web-push 파이프라인 재사용)

### 제외 (의도적)
- **`deploy-lagging` 판정** — "Build 는 success 인데 운영 컨테이너가 옛 이미지"를
  판정하려면 운영 digest 가 DB 에 있어야 한다. 확인 결과 `autopilot_cycles` 에는
  digest 컬럼이 없고 deploy-watcher 는 digest 를 메모리·파일로만 다룬다.
  DB 기록을 추가하는 것은 배포 오케스트레이션 도메인 변경이라 이번 범위 밖.
  → 후속 과제 (§9)
- 이슈·PR 에 대한 쓰기 액션 (닫기·라벨링·머지). 읽기 전용 보드.
- PR/이슈 정체에 대한 알림. 노이즈 억제를 위해 보드 표시만.

## 3. 아키텍처

기존 관제와 동일한 단방향 파이프라인을 따른다 — 외부 소스를 cron 이 폴링해 DB 에
적재하고, RSC 는 DB 만 읽는다.

```
cron(5분) ──> POST /api/cron/github-sync ──> GitHub REST API (PAT)
                     │
                     ├──> github_issues          (open 만; 닫히면 삭제)
                     ├──> github_pull_requests   (open 만; 닫히면 삭제)
                     ├──> github_workflow_runs   (레포당 최근 20건)
                     └──> monitoring_events      (critical 시 recordEvent/resolveEvent)
                                  │
        /monitoring/github (RSC, DB read only) <──┘
```

### 왜 live fetch 가 아닌가
관제 페이지는 `force-dynamic` + AutoRefresh 15초 폴링이다. RSC 에서 매 폴링마다
GitHub 를 호출하면 rate limit 을 소진하고, 히스토리 축적과 알림 연동이 불가능하다.

### rate limit 예산

Search API 로 org 전체를 한 번에 조회해 레포 수에 비례한 증가를 막는다.

| 호출 | 엔드포인트 | 요청/사이클 |
|---|---|---|
| 열린 이슈 | `GET /search/issues?q=org:krdn+is:issue+is:open` | 1 (+페이지) |
| 열린 PR | `GET /search/issues?q=org:krdn+is:pr+is:open` | 1 (+페이지) |
| Actions | `GET /repos/{owner}/{repo}/actions/runs` × 활성 레포 | N |

`Search` 는 별도 쿼터(인증 30 req/min)를 쓰므로 core 5000/h 와 분리된다.
Actions 대상 레포는 **최근 7일 내 push 가 있었던 레포**로 좁힌다 (`GET /orgs/krdn/repos?sort=pushed`
1회로 목록 획득). 실측 기준 N ≤ 10 이므로 5분 사이클에 약 12 req → 시간당 144 req.

페이지네이션은 각 쿼리당 최대 2페이지(200건)로 자른다. 초과분은 보드에서
"GitHub 에서 더 보기" 링크로 위임한다 — 관제 보드는 전수 목록이 아니라 판단 도구다.

## 4. 데이터 모델

신규 테이블 3개. 모두 GitHub 가 단일 진실 소스이므로 **동기화 시 전체 교체**
(open 집합 스냅샷) 전략을 쓴다. 닫힌 항목을 추적할 필요가 없어 tombstone 이 불필요하다.

```ts
// github_issues — 열린 이슈 스냅샷
{
  id: text primary key,           // "krdn/gons-dashboard#323"
  repo: text notNull,             // "krdn/gons-dashboard"
  number: integer notNull,
  title: text notNull,
  url: text notNull,
  author: text,
  labels: jsonb<string[]> notNull default [],
  createdAt: timestamptz notNull, // GitHub 기준 생성 시각
  updatedAt: timestamptz notNull,
  syncedAt: timestamptz notNull defaultNow(),
}

// github_pull_requests — 열린 PR 스냅샷
{
  id: text primary key,           // "krdn/gons-dashboard#330"
  repo, number, title, url, author, createdAt, updatedAt, syncedAt,  // 위와 동일
  isDraft: boolean notNull default false,
  // Search API 는 CI 상태를 주지 않는다. PR 별 추가 호출을 피하기 위해
  // workflow_runs 에서 headSha 로 조인해 파생한다 (§5).
  headSha: text,
}

// github_workflow_runs — 레포별 최근 run
{
  id: text primary key,           // GitHub run id (문자열화)
  repo: text notNull,
  workflowName: text notNull,
  status: text notNull,           // queued | in_progress | completed
  conclusion: text,               // success | failure | cancelled | skipped | null
  headSha: text notNull,
  headBranch: text,
  event: text,                    // push | pull_request | schedule ...
  url: text notNull,
  startedAt: timestamptz,
  completedAt: timestamptz,
  syncedAt: timestamptz notNull defaultNow(),
}
```

인덱스:
- `github_issues (repo, updated_at desc)`
- `github_pull_requests (repo, created_at)` — 정체 기간 정렬용
- `github_workflow_runs (repo, started_at desc)`
- `github_workflow_runs (head_sha)` — PR CI 상태 조인용

보존: 동기화가 open 집합을 통째로 교체하므로 이슈·PR 은 자연 정리된다.
`github_workflow_runs` 는 레포당 최근 20건만 유지 (동기화 시 초과분 삭제).
별도 purge cron 이 필요 없다 — Phase 3 의 `metric_samples` 무제한 증가 사고를
반복하지 않기 위한 의도적 설계다.

## 5. 판정 규칙 (순수 함수)

모든 판정은 `features/github-monitor/lib/` 의 순수 함수로 구현하고 단위 테스트한다.
DB·네트워크 의존을 함수 밖에 두어 판정 로직만 독립 검증 가능하게 한다.

### 5.1 배포 파이프라인 상태 (`judgeBuildState`)

입력: `{ mainHeadSha, runs: WorkflowRun[] }` — gons-dashboard 의 main 브랜치 run 만.

| 상태 | 조건 | severity |
|---|---|---|
| `synced` | mainHeadSha 의 Build run 이 `completed`/`success` | ok |
| `building` | mainHeadSha 의 run 이 `queued`/`in_progress` | ok |
| `build-failed` | mainHeadSha 의 run 이 `completed`/`failure` | **critical** |
| `no-run` | mainHeadSha 에 대응하는 run 이 없음 (동기화 지연 또는 미트리거) | warning |

`no-run` 은 push 직후 몇 분간 정상적으로 발생한다. 오탐을 막기 위해
**main HEAD 커밋 시각이 10분 이내면 `building` 으로 취급**한다.

### 5.2 PR CI 상태 (`derivePrCiStatus`)

Search API 는 CI 결과를 주지 않고, PR 별 조회는 N+1 호출이 된다.
대신 `github_workflow_runs` 를 `headSha` 로 조인해 파생한다.

- 해당 sha 의 run 이 하나라도 `failure` → `failing`
- 전부 `success` → `passing`
- 진행 중이 있으면 → `running`
- run 이 없으면 → `unknown` (PR 브랜치가 Actions 트리거 대상이 아닐 수 있음)

`unknown` 은 경고로 취급하지 않는다 — 정상 상태이기도 하기 때문.

### 5.3 정체 판정 (`judgeStaleness`)

보드 강조용이며 알림은 발행하지 않는다.

| 대상 | warn 임계 |
|---|---|
| PR | 생성 후 7일 경과 (draft 제외) |
| `needs-triage` 이슈 | 생성 후 14일 경과 |

임계값은 `features/github-monitor/config/thresholds.ts` 에 상수로 분리한다
(Phase 4 datastore 판정과 같은 패턴).

## 6. 알림 연동

기존 `monitoring_events` 파이프라인을 그대로 탄다 — 별도 알림 경로를 만들지 않는다.
`monitoringEvents.source` 유니온에 `"github"` 를 추가하고, `hostId` 는 null 로 둔다
(스키마상 nullable 이므로 변경 불필요).

동기화 cron 이 판정 후 발행한다:

| 조건 | dedupKey | severity |
|---|---|---|
| `build-failed` 진입 | `github:krdn/gons-dashboard:build-failed` | critical |
| 그 외 상태로 회복 | 위 키로 `resolveEvent` | — |

`recordEvent` 는 동일 dedupKey 의 open 이벤트를 억제하므로 5분마다 재발행해도
중복 알림이 나가지 않는다. 회복 시 `resolveEvent` 가 `resolvedAt` 을 채우고
기존 `monitoring-notify` sweep 이 해소 통지를 보낸다.

**관측은 best-effort** — 이벤트 발행 실패가 동기화 자체를 실패시키면 안 된다.
`recordEvent` 호출은 try/catch 로 감싸 삼킨다 (메모리 `observability-must-be-best-effort`).

## 7. FSD 배치

```
entities/github-activity/
  model/types.ts        # GithubIssue, GithubPullRequest, GithubWorkflowRun, BuildState
  api/queries.ts        # DB read (listOpenIssues, listOpenPrs, listRecentRuns)
  api/sync.ts           # DB write (replaceIssues, replacePrs, upsertRuns)
  server.ts             # server entrypoint (import "server-only")
  client.ts             # 타입·상수만 (client 위젯용)

features/github-monitor/
  config/thresholds.ts  # 정체 임계값, 페이지 상한, 활성 레포 판정 기간
  lib/githubClient.ts   # fetch 래퍼 (PAT 인증, 페이지네이션, 에러 정규화)
  lib/judgeBuildState.ts
  lib/derivePrCiStatus.ts
  lib/judgeStaleness.ts
  lib/*.test.ts         # 판정 순수 함수 단위 테스트
  index.ts              # server entrypoint

widgets/monitoring/ui/
  GithubKpiStrip.tsx
  BuildStateCard.tsx
  WorkflowRunsBoard.tsx
  PullRequestsBoard.tsx
  IssuesBoard.tsx

app/(dashboard)/monitoring/
  layout.tsx            # 탭 셸 (인프라 | GitHub) — 신설
  page.tsx              # 기존 인프라 보드 (변경 최소)
  github/page.tsx       # 신설

app/api/cron/github-sync/route.ts
```

### 왜 `entities/monitoring` 이 아닌 별도 entity 인가
기존 관제 entity 는 host·container·check 중심이고 수명주기가 push/agent 기반이다.
GitHub 는 외부 SaaS 를 폴링하는 완전히 다른 도메인이며 스키마·보존 정책도 다르다.
같은 entity 에 넣으면 `server.ts` 가 두 도메인을 섞어 barrel 이 비대해진다.

`client.ts` 를 처음부터 분리하는 이유는 Gotcha #1 의 재발 방지다 — 위젯이 타입을
필요로 하는 순간 server barrel 을 끌어오면 client bundle 에 postgres 가 들어간다.

## 8. 네비게이션

`navigation.ts` 는 변경하지 않는다. 관제는 `/monitoring` 을 가리키는 top-level leaf 로
유지한다 ("고빈도 operational 조회 — 그룹에 숨기지 않는다"는 기존 의도적 결정).

대신 `app/(dashboard)/monitoring/layout.tsx` 에 탭 셸을 추가한다:

```
/monitoring 페이지 상단:
 ┌──────────┬────────┐
 │ 인프라    │ GitHub │
 └──────────┴────────┘
```

탭은 `usePathname()` 기반 client 컴포넌트로 활성 상태를 판정한다.
`/monitoring` 과 `/monitoring/github` 두 라우트가 layout 을 공유하므로
탭 전환 시 셸이 재마운트되지 않는다.

## 9. 환경 변수

| 변수 | 필수 | 설명 |
|---|---|---|
| `GITHUB_MONITOR_TOKEN` | 선택 | Fine-grained PAT (org krdn, read-only: Issues·PR·Actions·Metadata). 빈 값이면 동기화 cron 이 skip 하고 보드는 empty state 를 표시한다. |
| `GITHUB_MONITOR_ORG` | 선택 | 기본값 `krdn` |

`env.ts` 의 Zod 스키마에 optional 로 추가한다. **필수로 만들지 않는 이유**: 토큰
누락이 앱 부팅 실패를 일으키면 안 된다 (관제 Phase 2 의 `TELEGRAM_BOT_TOKEN` 과 동일 패턴).

운영 배포 시 `docker-compose.yml` 의 `environment` 에도 라인 추가가 필요하다
(메모리 `compose-missing-saju-env-uses-code-default` — `.env` 만으로는 닿지 않는다).
compose 파일은 git 미동기화이므로 scp + sudo cp 선행 (메모리 `prod-compose-file-not-git-synced`).

## 10. 테스트 전략

| 계층 | 대상 | 방식 |
|---|---|---|
| 순수 함수 | `judgeBuildState`, `derivePrCiStatus`, `judgeStaleness` | 단위 테스트. 경계값(10분 유예, 7일/14일 임계)과 오탐 방지 케이스 필수 |
| API 클라이언트 | `githubClient` | 페이지네이션·에러 정규화를 fetch mock 으로 검증 |
| 통합 | `github-sync` 라우트 | `TEST_DATABASE_URL` 로 upsert·삭제·이벤트 발행 검증 |
| UI | 보드 위젯 | empty state 와 severity 강조만 (jsdom) |

`judgeBuildState` 의 `no-run` 10분 유예는 **시각 주입**으로 테스트한다
(`nowFn` 파라미터). 메모리 `cron-catchup-wait-not-finite-retry` 의 교훈 —
wall-clock 의존 로직은 시각을 주입하지 않으면 검증 불가능하다.

## 11. 후속 과제

1. **`deploy-lagging` 판정** — deploy-watcher 가 배포 성공 시 digest 를 DB 에
   기록하도록 확장한 뒤, main HEAD ↔ Build ↔ 운영 digest 3자 비교로 승격.
   이것이 완성되면 "CI Build success ≠ 운영 배포" 함정이 완전히 관제로 편입된다.
2. **레포별 필터** — 레포 수가 늘어 보드가 붐비면 레포 선택 UI 추가.
3. **추세** — 주간 이슈 유입/해소 비율. 현재 스냅샷 모델로는 불가하며
   히스토리 테이블이 필요하다. 실제 필요가 생기기 전까지 보류 (YAGNI).
