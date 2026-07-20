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
  → 후속 과제 (§11)
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
**Search 쿼터(인증 30 req/min)와 core 쿼터(5000 req/h)는 별개로 계산한다.**

| # | 호출 | 엔드포인트 | 쿼터 | 요청/사이클 |
|---|---|---|---|---|
| 1 | 열린 이슈 | `GET /search/issues?q=org:krdn+is:issue+is:open&sort=updated&order=desc&per_page=100` | search | 1~2 |
| 2 | 열린 PR | `GET /search/issues?q=org:krdn+is:pr+is:open&sort=updated&order=desc&per_page=100` | search | 1~2 |
| 3 | 활성 레포 목록 | `GET /orgs/krdn/repos?sort=pushed&direction=desc&per_page=100` | core | 1~2 |
| 4 | Actions run | `GET /repos/{owner}/{repo}/actions/runs?per_page=20` × 활성 레포 N | core | N |
| 5 | main Build run | `GET /repos/krdn/gons-dashboard/actions/workflows/{id}/runs?branch=main&per_page=5` | core | 1 |
| 6 | main HEAD 커밋 | `GET /repos/krdn/gons-dashboard/commits/main` | core | 1 |
| 7 | PR HEAD sha | `GET /repos/{owner}/{repo}/pulls/{n}` × 열린 PR M | core | M |

N=10, M=10 기준 사이클당 **search 2~4 req + core 23~24 req**.
시간당 core ≈ 288 req (5000 한도의 6%), search ≈ 48 req/h (한도는 분당 기준이라
사이클 내 4 req 는 30/min 대비 여유).

- **#3 은 `pushed` 내림차순 정렬 후 7일 cutoff 를 만나는 페이지에서 순회를 멈춘다.**
  1회로 끝난다는 보장은 없으므로 최대 2페이지로 상한을 둔다.
- **#4 의 활성 레포 필터와 무관하게 `krdn/gons-dashboard` 는 항상 포함한다** —
  7일간 push 가 없어도 배포 파이프라인 판정 대상이기 때문.
- **#5 는 #4 와 별도로 호출한다.** 레포 전체 최근 20건에는 PR·schedule run 이
  섞여 main Build run 이 밀려날 수 있다. 워크플로를 **이름이 아닌 `workflowId`
  (또는 `path`)로 지정**하고 `branch=main` 으로 좁힌다. 워크플로 식별자는
  `config/thresholds.ts` 에 상수로 둔다.
- **#7 은 Search 응답에 `head.sha` 가 없기 때문에 필요하다** (§5.2).
  M 이 커지면 비용이 선형 증가하므로 상한 20개로 자르고, 초과 PR 의 CI 상태는
  `unknown` 으로 둔다.

### 결과 집합의 성격 — 전수가 아니라 스냅샷

Search API 는 정렬된 결과를 최대 1000건까지만 제공한다. 이 설계는 각 쿼리당
2페이지(200건)에서 자르므로, 보드가 보여주는 것은 **"전체 open 집합"이 아니라
`updated` 내림차순 최근 200건 스냅샷"** 이다.

응답의 `total_count` 를 저장해 보드 상단에 `표시 200 / 전체 N` 을 명시하고,
잘렸을 때 "GitHub 에서 더 보기" 링크를 노출한다. 관제 보드는 전수 목록이 아니라
판단 도구이므로 의도된 절충이다.

Search 응답의 `incomplete_results: true` 는 GitHub 가 쿼리를 타임아웃시켰다는
뜻이므로 **부분 결과로 스냅샷을 교체하지 않는다** (§4.2).

## 4. 데이터 모델

신규 테이블 4개. GitHub 가 단일 진실 소스이므로 **동기화 시 전체 교체**
(open 집합 스냅샷) 전략을 쓴다. 닫힌 항목을 추적할 필요가 없어 tombstone 이 불필요하다.
단, 교체는 §4.2 의 안전 규칙을 지켜야 한다.

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
  // PR 의 현재 HEAD 커밋 sha. Search Issues 응답에는 이 값이 없으므로
  // GET /repos/{o}/{r}/pulls/{n} 로 별도 취득한다 (§3 예산 #7, §5.2).
  // null = 취득 실패 또는 상한 초과 → CI 상태 unknown.
  headSha: text,
}

// github_workflow_runs — 레포별 최근 run
{
  id: text primary key,           // GitHub run id (문자열화)
  repo: text notNull,
  workflowId: text notNull,       // 안정 식별자. 이름은 변경될 수 있어 판정에 쓰지 않는다.
  workflowName: text notNull,     // 표시용
  status: text notNull,           // queued | in_progress | completed | requested | waiting | pending
  conclusion: text,               // success | failure | cancelled | skipped | neutral
                                  // | timed_out | action_required | stale | startup_failure | null
  headSha: text notNull,
  headBranch: text,
  event: text,                    // push | pull_request | schedule ...
  runNumber: integer notNull,     // 워크플로 내 실행 순번 — 서로 다른 run 간 순서 결정
  runAttempt: integer notNull default 1,  // 같은 run 의 재시도 번호
  url: text notNull,
  startedAt: timestamptz,
  completedAt: timestamptz,
  syncedAt: timestamptz notNull defaultNow(),
}

// github_sync_state — 동기화 건강 상태 (레포 무관 단일 행 × 소스별)
// 보드가 "데이터 없음"과 "데이터가 낡음"을 구분하기 위해 필요하다.
{
  source: text primary key,       // "issues" | "pulls" | "runs" | "build"
  lastAttemptAt: timestamptz,
  lastSuccessAt: timestamptz,     // null = 한 번도 성공한 적 없음
  lastError: text,                // 마지막 실패 사유 (표시용)
  totalCount: integer,            // Search total_count — 스냅샷이 잘렸는지 판정
  truncated: boolean notNull default false,
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

### 4.1 main HEAD 와 Build 판정 결과

`judgeBuildState` 는 `mainHeadSha` 와 `mainHeadCommittedAt` 을 모두 필요로 한다
(10분 유예 판정). RSC 는 DB 만 읽으므로 이 값들이 DB 에 있어야 한다.

별도 테이블을 만들지 않고 **`github_sync_state` 의 `source = "build"` 행에
판정 결과를 저장**한다. 판정은 순수 함수가 동기화 시점에 수행하고, 그 결과만
보존한다 — RSC 가 다시 판정하면 두 곳에 로직이 생긴다.

```ts
// source = "build" 행의 확장 컬럼 (nullable — 다른 source 에는 무의미)
{
  buildState: text,               // synced | building | build-failed | no-run | unknown
  mainHeadSha: text,
  mainHeadCommittedAt: timestamptz,
  buildRunUrl: text,
  buildConclusion: text,
}
```

### 4.2 스냅샷 교체 안전 규칙

전체 교체는 **부분 실패 시 기존 데이터를 지우는** 위험이 있다. 다음을 보장한다:

1. **수집 완료 후 교체.** 한 소스의 모든 페이지를 성공적으로 받은 뒤에만
   `DELETE + INSERT` 를 단일 트랜잭션으로 실행한다. 페이지 도중 실패하면
   그 소스는 교체하지 않고 이전 스냅샷을 유지한다.
2. **소스별 독립.** 이슈 동기화가 실패해도 PR·runs 는 각자 교체된다.
   Actions 는 **레포 단위로 독립** — 한 레포 조회가 실패하면 그 레포의 이전
   run 만 유지하고 나머지는 갱신한다.
3. **`incomplete_results: true` 는 실패로 취급.** GitHub 가 쿼리를 타임아웃시킨
   부분 결과로 교체하면 멀쩡한 항목이 사라진다.
4. **인증·rate limit 실패 시 교체하지 않는다.** `lastError` 에만 기록한다.
5. **토큰 미설정 시에도 기존 행을 지우지 않는다.** 동기화를 건너뛰고
   `lastAttemptAt` 만 갱신하며, 보드는 "동기화 비활성" 배지를 표시한다.

보드는 아래를 **순서대로** 평가해 상태를 정한다. `lastError` 가 freshness 보다
우선한다 — 최근에 성공한 적이 있어도 **직전 시도가 실패했으면 그 사실을 먼저
알려야** 한다.

| 순서 | 조건 | 보드 표시 |
|---|---|---|
| 1 | 토큰 미설정 + `lastSuccessAt` null | "동기화 비활성" (empty state) |
| 2 | 토큰 미설정 + `lastSuccessAt` 있음 | 이전 스냅샷 + "동기화 비활성" 배지 |
| 3 | **`lastError` 가 비어있지 않음** | 보유한 데이터 + **오류 배지 + `lastError`** |
| 4 | `lastSuccessAt` 이 null | "아직 동기화된 적 없음" (empty state) |
| 5 | `lastSuccessAt` 이 15분 초과 | 보유한 데이터 + **stale 배지** |
| 6 | 그 외 | 정상 |

3번이 4번보다 앞서므로 **첫 동기화가 부분 성공인 경우**(`lastSuccessAt` null +
`lastError` 있음)에도 empty state 가 아니라 **성공한 레포의 행을 보여주면서
오류 배지**를 단다. 데이터가 있는데 "없음"이라 표시하는 것을 막는다.

**`lastError` 는 전체 성공 시 null 로 지운다.** 지우지 않으면 한 번 실패한 뒤
영구히 오류 배지가 남는다.

이 구분이 없으면 "이슈가 0건"과 "동기화가 죽어서 안 보임"을 혼동한다.

### 4.3 `runs` 소스의 부분 성공 처리

Actions 는 레포 단위로 독립 갱신되므로(§4.2 규칙 2), `source = "runs"` 단일 행의
`lastSuccessAt` 이 무엇을 뜻하는지 정의가 필요하다.

**`lastSuccessAt` 은 대상 레포 전체가 성공했을 때만 갱신한다.** 일부 레포가
실패하면:
- 성공한 레포의 run 은 정상 교체된다 (데이터는 최신).
- `lastAttemptAt` 만 갱신하고 `lastSuccessAt` 은 그대로 둔다.
- `lastError` 에 실패한 레포 목록을 기록한다 (예: `"3개 레포 실패: a, b, c"`).

결과적으로 보드는 부분 실패를 stale 로 표시한다. 이는 보수적 선택이다 —
"일부만 낡았다"를 행 단위로 표현하려면 `(source, repo)` 복합키가 필요한데,
현재 레포 수(N ≤ 10)에서 그 복잡도는 정당화되지 않는다. 레포별 정밀 표시가
필요해지면 그때 복합키로 전환한다 (§11 후속).

## 5. 판정 규칙 (순수 함수)

모든 판정은 `features/github-monitor/lib/` 의 순수 함수로 구현하고 단위 테스트한다.
DB·네트워크 의존을 함수 밖에 두어 판정 로직만 독립 검증 가능하게 한다.

### 5.0 GitHub 상태값 정규화 (`normalizeRunOutcome`)

GitHub 의 `status` / `conclusion` 조합은 문서에 나온 것보다 넓다. 판정 함수가
모르는 값을 만나 조용히 오분류하지 않도록, 먼저 4값으로 정규화한다.

| 정규화 결과 | GitHub 값 |
|---|---|
| `success` | `conclusion = success` |
| `failure` | `conclusion ∈ {failure, timed_out, startup_failure, action_required}` |
| `running` | `status ∈ {queued, in_progress, requested, waiting, pending}` |
| `inconclusive` | `conclusion ∈ {cancelled, skipped, neutral, stale}` 또는 미지의 값 |

**`inconclusive` 를 성공으로도 실패로도 보지 않는 것이 핵심이다.** 취소된 run 을
실패로 보면 사람이 의도적으로 중단한 빌드마다 critical 알림이 나가고, 성공으로
보면 실제로 검증되지 않은 커밋이 정상으로 표시된다.

미지의 값은 `inconclusive` 로 떨어뜨리되 `logger.warn` 을 남겨 GitHub 가 새 값을
도입했을 때 알 수 있게 한다.

### 5.1 배포 파이프라인 상태 (`judgeBuildState`)

입력:
```ts
{
  mainHeadSha: string,
  mainHeadCommittedAt: Date,
  runs: WorkflowRun[],   // 지정 workflowId, branch=main 의 run 만
  nowFn: () => Date,     // 시각 주입 (테스트용)
}
```

**대상 run 선택 규칙** (다중 run 처리):
1. `workflowId` 가 설정된 Build 워크플로와 일치하는 run 만 본다 (이름 아님).
2. `headSha === mainHeadSha` 인 run 만 본다.
3. 그중 **`(runNumber, runAttempt)` 사전순 최대인 것 하나**를 택한다.

3번에서 `runAttempt` 만으로는 부족하다. `runAttempt` 는 **개별 run 안에서의
재시도 번호**라서, 같은 workflow·같은 SHA 에 대해 서로 다른 run 이 여러 개
존재하면(워크플로 파일 수정 후 재푸시, 서로 다른 트리거 중복 등) 모두
`runAttempt = 1` 이 되어 순서를 정할 수 없다. `runNumber` 가 워크플로 전체에서
단조 증가하므로 이것을 1차 키로 쓴다.

실패 후 재실행 중이면 `building` 이 되며, 이는 의도된 동작이다 —
**보드에는 `building` 으로 표시하되, 성공이 확인되기 전까지 기존 critical
이벤트는 해소하지 않는다** (§6 의 `building` no-op). 재실행이 다시 실패할 수
있으므로 "조치 중"은 "복구됨"이 아니다.

| 상태 | 조건 | severity |
|---|---|---|
| `synced` | 대상 run 이 `success` | ok |
| `building` | 대상 run 이 `running` | ok |
| `build-failed` | 대상 run 이 `failure` | **critical** |
| `no-run` | 대상 run 없음 + 커밋 후 10분 초과 | warning |
| `unknown` | 대상 run 이 `inconclusive`, 또는 커밋 후 10분 이내 + run 없음 | — |

`no-run` 은 push 직후 정상적으로 발생한다. **커밋 시각이 10분 이내면 `unknown`**
으로 두어 오탐을 막는다 (`building` 이 아니라 `unknown` 인 이유: 워크플로가
트리거됐는지 확인되지 않았으므로 "진행 중"이라 단정할 수 없다).

`unknown` 은 알림을 발행하지도, 기존 알림을 해소하지도 않는다 (§6).

### 5.2 PR CI 상태 (`derivePrCiStatus`)

**Search Issues 응답에는 PR 의 `head.sha` 가 없다.** 따라서 §3 예산 #7 로
`GET /repos/{o}/{r}/pulls/{n}` 을 호출해 현재 HEAD sha 를 취득해 저장한다.

`workflow_runs.head_sha` 단순 조인은 안전하지 않다:
- `pull_request` 이벤트 run 의 `head_sha` 는 **합성 merge SHA** 일 수 있다.
- `pull_request_target` 은 base SHA 를 가리킨다.

따라서 조인은 다음 조건을 모두 만족하는 run 만 대상으로 한다:
- `run.headSha === pr.headSha` (저장된 PR HEAD 와 정확히 일치)
- `run.event ∈ {push, pull_request}` — `pull_request_target` 등은 제외

집계는 **workflow 별로 `(runNumber, runAttempt)` 최대인 run 하나씩** 취한 뒤
정규화 결과로 판정한다 (§5.1 과 동일한 선택 규칙):

판정은 **순서대로 평가하고 마지막을 catch-all 로 둔다** — 명시 조건만 나열하면
`success + inconclusive` 같은 혼합 조합이 어느 분기에도 걸리지 않는다.

| 순서 | 결과 | 조건 |
|---|---|---|
| 1 | `failing` | 하나라도 `failure` |
| 2 | `running` | (`failure` 없음) 하나라도 `running` |
| 3 | `passing` | (위 둘 아님) 전부 `success` |
| 4 | `unknown` | **그 외 전부** — 대상 run 없음, `pr.headSha` 미취득, 전부 `inconclusive`, `success`+`inconclusive` 혼합 |

`success` + `inconclusive` 혼합이 `passing` 이 아닌 이유: 취소·스킵된 워크플로가
있으면 그 검증은 수행되지 않았으므로 "통과"라 단정할 수 없다. 보수적으로
`unknown` 으로 둔다 (§5.0 의 `inconclusive` 취급과 일관).

`unknown` 은 경고로 취급하지 않는다 — PR 브랜치가 Actions 트리거 대상이
아닌 정상 상태일 수 있기 때문.

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

동기화 cron 이 판정 후 발행한다. dedupKey 는
`github:krdn/gons-dashboard:build-failed` 하나를 쓴다.

| `buildState` | 동작 |
|---|---|
| `build-failed` | `recordEvent(critical)` |
| `synced` | `resolveEvent` |
| `building` | **no-op** |
| `no-run` | **no-op** |
| `unknown` | **no-op** |
| 동기화 실패 (API 오류·토큰 없음) | **no-op** — 판정 자체를 수행하지 않는다 |

**`synced` 일 때만 해소한다.** 이것이 기존 관제 정책과 일치하는 지점이다 —
`monitoring-ingest` 의 check 판정도 `ok` 일 때만 `resolveEvent` 를 부르고
`unknown` 은 명시적 no-op 이며, 코드 주석이 이유를 밝히고 있다:

> unknown: no-op — 관찰 불가는 위반도 정상 복귀도 아니다. (…) 방화벽이
> 복구됐는지 **확인할 수 없는** 상태에서 이벤트를 해소하면 실제로 뚫린 채로
> 알림만 사라진다.

같은 논리가 여기에도 적용된다. "그 외 상태면 해소"로 구현하면 **Build 가 계속
실패 중인데 GitHub API 가 잠시 죽었을 때 "복구됨" 알림이 나간다.** 관제에서
이는 침묵보다 나쁘다 — 거짓 안심을 주기 때문이다.

`recordEvent` 는 동일 dedupKey 의 open 이벤트를 억제하므로 5분마다 재판정해도
중복 알림이 나가지 않는다. 해소 시 `monitoring-notify` sweep 이 해소 통지를 보낸다.

**관측은 best-effort** — 이벤트 발행 실패가 동기화 자체를 실패시키면 안 된다.
`recordEvent` 와 `resolveEvent` **둘 다** try/catch 로 감싸 삼킨다
(메모리 `observability-must-be-best-effort`).

### 6.1 알림 링크

현행 `monitoring-notify` 는 모든 알림의 `url` 을 `/monitoring` 으로 고정한다.
GitHub 이벤트는 `/monitoring/github` 로 보내는 것이 맞으므로, notifier 가
`source === "github"` 일 때 링크를 분기하도록 최소 수정한다.

`EventSource` 유니온에 `"github"` 를 추가하고 (`entities/monitoring/model/types.ts`),
`monitoring.ts` 스키마의 source 주석도 함께 갱신한다.

## 7. FSD 배치

```
shared/lib/db/schema/github.ts     # 신규 테이블 4개 + schema/index.ts 재export
drizzle/00XX_github_monitoring.sql # 마이그레이션 (운영은 psql BEGIN/COMMIT 선적용)

entities/github-activity/
  model/types.ts        # GithubIssue, GithubPullRequest, GithubWorkflowRun,
                        # BuildState, RunOutcome, PrCiStatus, SyncState
  api/queries.ts        # DB read (listOpenIssues, listOpenPrs, listRecentRuns,
                        #          getBuildState, getSyncStates)
  api/sync.ts           # DB write (replaceIssues, replacePrs, replaceRunsForRepo,
                        #          upsertSyncState) — 트랜잭션 교체 (§4.2)
  server.ts             # server entrypoint (import "server-only")
  client.ts             # 타입·상수만 (client 위젯용)

features/github-monitor/
  config/thresholds.ts  # 정체 임계값, 페이지 상한, 활성 레포 기간,
                        # BUILD_WORKFLOW_ID, stale 임계(15분), PR HEAD 조회 상한
  lib/githubClient.ts   # fetch 래퍼 (PAT 인증, 페이지네이션, 에러 정규화,
                        #             incomplete_results 판정)
  lib/normalizeRunOutcome.ts
  lib/judgeBuildState.ts
  lib/derivePrCiStatus.ts
  lib/judgeStaleness.ts
  lib/*.test.ts         # 판정 순수 함수 단위 테스트
  index.ts              # server entrypoint (동기화 오케스트레이션)

widgets/monitoring/ui/
  MonitoringTabs.tsx    # "use client" — usePathname() 기반 활성 탭 판정
  GithubKpiStrip.tsx
  BuildStateCard.tsx
  WorkflowRunsBoard.tsx
  PullRequestsBoard.tsx
  IssuesBoard.tsx
  SyncStaleBadge.tsx    # lastSuccessAt 기반 stale 표시 (§4.2)

app/(dashboard)/monitoring/
  layout.tsx            # 탭 셸 — 신설. MonitoringTabs 렌더
  page.tsx              # 기존 인프라 보드 (변경 최소)
  github/page.tsx       # 신설. page.tsx 와 동일하게 auth() → redirect("/login")
                        # + export const dynamic = "force-dynamic"

app/api/cron/github-sync/route.ts  # createCronHandler 사용 (기존 패턴)
apps/cron/scheduler.js             # 5분 주기 호출 등록 (*/5 * * * *)

features/monitoring-notify/index.ts  # source === "github" 시 링크 분기 (§6.1)
entities/monitoring/model/types.ts   # EventSource 에 "github" 추가
```

인증은 각 page 에서 개별 처리한다 (`layout.tsx` 가 아니라). 기존 `page.tsx` 가
이미 그 패턴이고, layout 인증은 Next 에서 라우트별 보호를 보장하지 않는다.

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
| `GITHUB_MONITOR_TOKEN` | 선택 | Fine-grained PAT (org krdn, read-only: Issues·PR·Actions·Metadata). 빈 값이면 동기화 cron 이 skip 한다. 보드 표시는 §4.2 표를 따른다 — 성공 이력이 없으면 empty state, 있으면 **이전 스냅샷 + "동기화 비활성" 배지**(기존 행을 지우지 않는다). |
| `GITHUB_MONITOR_ORG` | 선택 | 기본값 `krdn` |

`env.ts` 의 Zod 스키마에 optional 로 추가한다. **필수로 만들지 않는 이유**: 토큰
누락이 앱 부팅 실패를 일으키면 안 된다 (관제 Phase 2 의 `TELEGRAM_BOT_TOKEN` 과 동일 패턴).

운영 배포 시 `docker-compose.yml` 의 `environment` 에도 라인 추가가 필요하다
(메모리 `compose-missing-saju-env-uses-code-default` — `.env` 만으로는 닿지 않는다).
compose 파일은 git 미동기화이므로 scp + sudo cp 선행 (메모리 `prod-compose-file-not-git-synced`).

## 10. 테스트 전략

| 계층 | 대상 | 방식 |
|---|---|---|
| 순수 함수 | `normalizeRunOutcome` | GitHub 상태값 전수 + 미지의 값 → `inconclusive` |
| 순수 함수 | `judgeBuildState` | 5개 상태 전이 + 10분 유예 경계 + `(runNumber, runAttempt)` 선택 |
| 순수 함수 | `derivePrCiStatus` | merge SHA 오조인 방지, workflow 별 `(runNumber, runAttempt)` 최신 집계, 혼합 조합 catch-all |
| 순수 함수 | `judgeStaleness` | 7일/14일 경계, draft 제외 |
| API 클라이언트 | `githubClient` | fetch mock — 페이지네이션, `incomplete_results`, 401/403/429 |
| 통합 | `github-sync` 라우트 | `TEST_DATABASE_URL` — 교체·부분실패 보존·이벤트 발행 |
| UI | 보드 위젯 | empty state, stale 배지, severity 강조 (jsdom) |

**반드시 포함할 회귀 가드** (이번 리뷰에서 드러난 결함들):

순수 함수 단위:
1. `runs: []` + 커밋 10분 이내 → `unknown`, 10분 초과 → `no-run`.
   (`runs: []` 는 **API 실패가 아니라 "정상 응답인데 run 이 없음"** 이다.
   API 실패는 판정 함수에 도달하지 않으므로 §6의 no-op 계약과 층이 다르다.)
2. 같은 workflow·같은 SHA 에 **서로 다른 run ID 가 모두 `runAttempt = 1`** 로
   존재할 때 `runNumber` 가 큰 쪽이 선택된다.
3. `conclusion: "cancelled"` 가 `failure` 로 분류되지 않는다.
4. PR 의 `headSha` 와 다른 sha 의 run 이 CI 상태에 영향을 주지 않는다.

통합 (동기화 라우트):
5. GitHub API 가 실패하면 **판정·`recordEvent`·`resolveEvent` 가 호출되지 않고**,
   기존 `build` 행과 open 이벤트가 그대로 유지된다.
6. 동기화 실패 시 기존 이슈 행이 **삭제되지 않는다** (§4.2 규칙 1).
7. `incomplete_results: true` 응답으로 스냅샷이 교체되지 않는다.
8. 일부 레포 Actions 조회 실패 시 그 레포 run 은 유지되고 나머지는 갱신되며,
   `runs` 의 `lastSuccessAt` 은 갱신되지 않는다 (§4.3).
9. 전체 성공 시 `lastError` 가 null 로 지워진다 (오류 배지가 영구히 남지 않음).

UI 상태 판정 (§4.2 표):
10. `lastSuccessAt` null + `lastError` 있음 (첫 동기화 부분 성공) → empty state 가
    아니라 **성공한 레포의 행 + 오류 배지**.
11. `lastSuccessAt` 이 15분 이내 + `lastError` 있음 → 정상이 아니라 **오류 배지**
    (freshness 보다 `lastError` 가 우선).

`judgeBuildState` 의 10분 유예는 **시각 주입**으로 테스트한다 (`nowFn` 파라미터).
메모리 `cron-catchup-wait-not-finite-retry` 의 교훈 — wall-clock 의존 로직은
시각을 주입하지 않으면 검증 불가능하다.

새 테스트 파일이 `.tsx` 이면 vitest include 설정을 확인한다
(메모리 `vitest-include-tsx-silent-skip` — include 밖 파일은 조용히 스킵된다).

## 11. 후속 과제

1. **`deploy-lagging` 판정** — deploy-watcher 가 배포 성공 시 digest 를 DB 에
   기록하도록 확장한 뒤, main HEAD ↔ Build ↔ 운영 digest 3자 비교로 승격.
   이것이 완성되면 "CI Build success ≠ 운영 배포" 함정이 완전히 관제로 편입된다.
2. **`(source, repo)` 복합키 sync state** — 현재 `runs` 는 단일 행이라 한 레포만
   실패해도 전체가 stale 로 표시된다(§4.3). 레포 수가 늘어 이 보수적 표시가
   실용성을 해치면 레포 단위 상태로 전환한다.
3. **레포별 필터** — 레포 수가 늘어 보드가 붐비면 레포 선택 UI 추가.
4. **추세** — 주간 이슈 유입/해소 비율. 현재 스냅샷 모델로는 불가하며
   히스토리 테이블이 필요하다. 실제 필요가 생기기 전까지 보류 (YAGNI).
