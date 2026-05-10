# 서버 인프라 모니터 — v0.1 설계

- **상태**: APPROVED (브레인스토밍 완료, 구현 계획 작성 직전)
- **작성일**: 2026-05-10
- **대상 버전**: v0.1 (Catalog-First)
- **선행 마일스톤**: v0.1 중요 이메일 위젯 (완료)
- **다음 단계**: `writing-plans` 스킬로 implementation plan 작성

## 1. 문제 정의

`gons-dashboard`는 개인 생산성 통합 대시보드를 지향한다. 첫 도메인(Email 분석)이
출시된 시점에서 두 번째 도메인을 추가한다. 사용자는 192.168.0.5 운영 서버에
15+개의 Docker 컨테이너를 직접 운영 중이며, 현재는 `dserver ps` 등 CLI로 수동
점검한다. 다음 네 가지 시나리오를 한 화면에서 다루고자 한다.

1. **헬스 모니터링** — 컨테이너 상태/구성을 한눈에 확인.
2. **조사/진단** — 이상 징후가 의심될 때 빠르게 들여다본다.
3. **프로젝트 카탈로그** — 컨테이너가 어떤 compose 프로젝트에 속하는지 자산 관리.
4. **이상 알림 (passive)** — 문제 발생 시 알림 (단, v0.1엔 시각적 배지만; 실제 푸시는 v0.2).

### 비목표 (Non-goals, v0.1)

- L2 리소스 메트릭 그래프 (CPU/MEM)
- L3 로그 패턴 분석 (ERROR/FATAL 자동 감지)
- L4 의존성/네트워크 교차 진단 (예: postgres 다운 → api 영향 추적)
- Web Push 알림 발송
- 다중 호스트 등록 UI (스키마는 지원, 실등록은 seed 1대)
- 실행 액션 중 `exec`, `rm`, `pull`, `image prune` 등 파괴적/광범위 명령

## 2. 요구사항 (Confirmed)

설계 직전 브레인스토밍에서 사용자가 확정한 결정사항.

| ID | 결정 | 비고 |
|----|------|------|
| D1 | 사용 시나리오 4종 모두 (모니터링/진단/카탈로그/알림) | 단 알림은 v0.1엔 시각 배지만 |
| D2 | 데이터 수집은 Docker context 직접 호출 | `home-server` context 재사용 |
| D3 | 그룹화는 `com.docker.compose.project` 라벨 기준 | 라벨 없는 것은 "standalone" 가상 그룹 |
| D4 | 분석 깊이 L4 비전, **v0.1은 L1만** | L2~L4는 v0.2~v0.3 |
| D5 | 알림 채널: 대시보드 배너/배지 + Web Push (v0.2 이후) | v0.1엔 시각 ⚠ 배지만 |
| D6 | 다중 호스트 가능한 일반화 디자인 | DB는 `hosts` 테이블 도입, 등록은 seed 1대 |
| D7 | 액션 권한: 읽기 + restart/start/stop | NextAuth + ADMIN_EMAILS allowlist |
| D8 | 시점 스냅샷만 — 시계열 보관 없음 | audit_logs는 예외 (액션 이력) |

## 3. 기술 스택

기존 v0.1 Email 위젯과 동일하게 재사용.

- **Framework**: Next.js 16 App Router
- **Language**: TypeScript
- **DB**: PostgreSQL + Drizzle ORM
- **Server state**: TanStack Query (클라 폴링용)
- **Auth**: NextAuth (이미 설정됨)
- **Validation**: Zod
- **Test**: Vitest + Testing Library + Playwright (E2E)
- **Docker 호출**: `docker` CLI을 `execFile`로 쓰레핑 (dockerode 미사용 — SSH context 단순함을 위해)

## 4. 아키텍처

### 4.1 전체 흐름

```
┌──────── Next.js Server (3020) ─────────┐
│                                         │
│  RSC: /, /servers/[hostName]            │
│        └─→ widgets/server-overview      │
│             └─→ features/host-catalog   │
│             └─→ features/container-list │
│  Server Actions: restartContainer 등    │
└────────────┬────────────────────────────┘
             │ docker --context home-server ...
             │ (Node child_process.execFile)
             ↓
   ┌──── 192.168.0.5 운영 서버 ─────┐
   │  Docker daemon + 컨테이너 일체  │
   └────────────────────────────────┘

PostgreSQL (Drizzle):
  hosts          — 등록된 도커 호스트
  projects       — compose project 메타데이터 (display name, 설명, pinned)
  audit_logs     — 컨테이너 액션 이력
```

### 4.2 FSD 슬라이스 구성

```
src/
├── entities/
│   ├── host/         — 등록된 도커 호스트 엔티티
│   │   ├── model/    (Host 타입, Zod schema)
│   │   ├── api/      (getHosts, getHostByName)
│   │   └── ui/       (HostBadge)
│   ├── project/      — compose project 메타데이터
│   │   ├── model/    (Project 타입)
│   │   ├── api/      (getProjects, upsertProjectFromContainer, setHidden)
│   │   └── ui/       (ProjectCard)
│   └── container/    — 라이브 컨테이너 (DB 없음, Docker 직접)
│       ├── model/    (ContainerSummary, ContainerInspect 타입, parser)
│       ├── api/      (listContainers, inspectContainer)
│       └── ui/       (ContainerStatusBadge, ContainerRow)
├── features/
│   ├── host-catalog/      — 호스트 목록 RSC + (v0.2) 등록 폼
│   ├── container-list/    — 호스트별 컨테이너 그리드, project별 그루핑, 필터
│   └── container-actions/ — restart/start/stop Server Actions + 확인 다이얼로그
├── widgets/
│   └── server-overview/   — 메인 페이지 카드 (요약)
└── shared/
    ├── lib/docker/        — docker CLI 어댑터 (runDocker, listContainers, inspect)
    └── config/env.ts      — ADMIN_EMAILS, DOCKER_DEFAULT_CONTEXT 추가
```

### 4.3 의존성 검증

`shared → entities → features → widgets → app` (FSD 표준)

- `entities/container`는 다른 entities와 직접 결합하지 않음. `composeProject` 라벨만
  보유하고, project와의 결합은 `features/container-list`의 grouping 함수에서 수행.
- `widgets/server-overview`는 `features/host-catalog` + `features/container-list`만 import.
- 모든 cross-slice import는 `index.ts`를 거침 (eslint-plugin-boundaries로 검증).

## 5. 데이터 모델

### 5.1 신규 테이블

```typescript
// shared/db/schema/hosts.ts
export const hosts = pgTable('hosts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),           // "home-server"
  dockerContext: text('docker_context').notNull(), // "home-server"
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// shared/db/schema/projects.ts
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  hostId: uuid('host_id').notNull().references(() => hosts.id, { onDelete: 'cascade' }),
  composeProject: text('compose_project').notNull(),
  displayName: text('display_name').notNull(),
  description: text('description'),
  category: text('category'),                       // "news" | "ai" | "infra" | "experiment" | null
  isPinned: boolean('is_pinned').notNull().default(false),
  isHidden: boolean('is_hidden').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  uniqueHostProject: unique().on(t.hostId, t.composeProject),
}));

// shared/db/schema/audit-logs.ts
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  hostId: uuid('host_id').notNull().references(() => hosts.id),
  containerId: text('container_id').notNull(),
  containerName: text('container_name').notNull(),
  action: text('action', { enum: ['restart', 'start', 'stop'] }).notNull(),
  userId: text('user_id').notNull(),                 // NextAuth user.email
  status: text('status', { enum: ['success', 'failed'] }).notNull(),
  errorMessage: text('error_message'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byCreatedAt: index().on(t.createdAt.desc()),
  byContainer: index().on(t.containerId, t.createdAt.desc()),
}));
```

### 5.2 라이브 타입 (DB 외부)

```typescript
type ContainerSummary = {
  id: string;
  name: string;
  hostId: string;
  composeProject: string | null;
  composeService: string | null;
  state: 'running' | 'exited' | 'restarting' | 'paused' | 'dead' | 'created';
  statusText: string;          // "Up 3 days", "Exited (0) 5d ago"
  uptimeSeconds: number | null;
  image: string;
  ports: PortMapping[];
  createdAt: string;            // ISO
};

type ContainerInspect = ContainerSummary & {
  restartCount: number;
  imageDigest: string | null;
  mounts: Array<{ source: string; target: string; type: string }>;
  envMasked: Array<{ key: string; value: string | '***' }>;
  labels: Record<string, string>;
};
```

### 5.3 그룹화 알고리즘

`docker container ls --format json` 출력의 `Labels` CSV에서
`com.docker.compose.project=<name>` 추출 → 그것이 그룹 키.

매칭 단계:
1. **자동 매칭**: `containers.composeProject === projects.composeProject` (동일 host 내).
2. **자동 생성**: 라벨이 있고 DB에 없는 경우 새 `projects` row 생성 (`displayName = composeProject` 그대로).
3. **standalone 그룹**: 라벨 없는 컨테이너는 가상 그룹 `"standalone"`에 모음 (DB row 미생성).
4. **수동 보완**: `isHidden`으로 노이즈 제거 가능. v0.1엔 토글만 제공, 실제 노출 UI는 v0.2.

## 6. 데이터 흐름

### 6.1 메인 페이지

```
사용자 / 접속
  ↓
RSC: src/app/page.tsx
  ↓ (병렬)
widgets/server-overview/ServerOverviewCard
  ├─ getHosts()                                    [DB]
  ├─ host별 listContainers(dockerContext) (병렬)    [Docker CLI]
  └─ host별 getProjects(hostId) (병렬)              [DB]
  ↓
서버에서 join → ProjectGroupSummary[]
  ↓
SSR 응답
  ↓
TanStack Query refetchInterval=60s로 클라이언트 갱신
```

### 6.2 호스트 상세 (`/servers/[hostName]`)

```
RSC가 listContainers + getProjects + 최근 audit_logs 5건 병렬 fetch
  ↓
container-list/groupByProject로 그루핑
  ↓
Project별 섹션 + ContainerRow + 액션 버튼 (admin만)
  ↓
TanStack Query refetchInterval=30s (focused일 때만)
```

### 6.3 컨테이너 액션

```
[Restart] 클릭
  ↓
확인 다이얼로그 (컨테이너 이름 + 정말? 확인)
  ↓
Server Action: restartContainer({ hostId, containerId })
  ├─ 1. auth() 세션 → email allowlist 검증
  ├─ 2. Zod input parse (containerId 정규식 강제)
  ├─ 3. hosts.dockerContext 조회 (사용자 입력 신뢰 안 함)
  ├─ 4. runDocker(context, ['restart', containerId], { timeoutMs: 10_000 })
  ├─ 5. audit_logs INSERT (success/failed, durationMs)
  └─ 6. revalidatePath(`/servers/${hostName}`)
  ↓
Toast + TanStack Query invalidate → UI 갱신
```

## 7. shared/lib/docker 어댑터

핵심 결정: **docker CLI 쓰레핑** (dockerode SDK 미사용).
- 이유: `--context home-server`는 SSH 인증/트랜스포트를 docker CLI가 알아서 처리.
  dockerode SSH 처리는 실험적이고 까다로움.
- 트레이드오프: NDJSON 파싱 필요, 에러 메시지 파싱이 다소 거칠다.

```typescript
// shared/lib/docker/client.ts
import 'server-only';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const runExecFile = promisify(execFile);

export async function runDocker(
  context: string,
  args: string[],
  opts: { timeoutMs?: number } = {}
): Promise<string> {
  const { stdout } = await runExecFile('docker', ['--context', context, ...args], {
    timeout: opts.timeoutMs ?? Number(process.env.DOCKER_CMD_TIMEOUT_MS ?? 10_000),
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}
```

**보안 핵심**: `execFile`만 사용, shell 보간 절대 금지. 인자는 항상 배열.

## 8. UI 구성

### 8.1 메인 대시보드 카드

```
┌──────────── ServerOverviewCard ─────────────┐
│  🖥 home-server (192.168.0.5)               │
│  ─────────────────────────────────────────  │
│  ✓ news-prod        4/4 running             │
│  ✓ ais-prod         5/5 running             │
│  ⚠ voice            0/3 — stopped           │
│  ⚠ krdn-fx          1/2 — 1 restarting      │
│  · n8n              3/3 running             │
│  · standalone       2/2 running             │
│  ─────────────────────────────────────────  │
│  [상세 보기 →]                              │
│  Last updated: 14:32:05 (60s 자동 갱신)     │
└─────────────────────────────────────────────┘
```

배지 정의:
- `✓` 모두 running
- `⚠` 1개 이상 비정상 (`exited` / `restarting` / `dead` / `paused`)
- pinned 프로젝트는 상단 고정, 나머지는 알파벳 순.

### 8.2 호스트 상세 (`/servers/[hostName]`)

호스트 1대인 v0.1엔 `/servers` 목록 페이지는 만들지 않음. 메인 카드 →
바로 `/servers/home-server`. v0.2 다호스트 시 목록 페이지 추가.

화면 구성:
- 헤더: 호스트명, IP/설명, docker context 연결 상태, 마지막 갱신 시각.
- Project 섹션 (한 카드씩): 컨테이너 행 + 액션 버튼.
- standalone 섹션: 라벨 없는 컨테이너.
- 최근 액션 5건 패널 (audit_logs).

### 8.3 컨테이너 상세 모달 (Optional, v0.1 후반)

행 클릭 시 우측 sliding panel:
- inspect 결과 요약 (image digest, restart count, mounts 일부)
- 포트 매핑 전체
- 라벨 전체
- envMasked
- 최근 audit_logs 10건

**시간 남으면** 추가. 출시 블로커 아님.

### 8.4 액션 UX

- restart/start/stop은 **항상 확인 다이얼로그** (이름 표시).
- 진행 중에는 버튼 disabled + spinner.
- 완료 시 toast + 행 상태 즉시 갱신 (TanStack Query invalidate).
- 5초 안에 응답 없으면 "백그라운드 진행 중" 메시지. audit_logs는 비동기 INSERT.

## 9. 에러 처리

| 시나리오 | 동작 |
|---|---|
| Docker daemon 응답 없음 | UI 배너 "192.168.0.5 연결 불가" + 마지막 성공 시각. 빈 리스트 X. |
| Docker context 미존재 | 시작 시 health check → 명확한 setup 에러 페이지 |
| 액션 실패 | toast + audit_logs 기록 (status=failed) |
| 인증 실패 | 401 → 로그인 페이지 redirect |
| Zod 파싱 실패 (1개 컨테이너) | 해당 1개만 skip + 서버 warn 로그, 나머지 정상 표시 |
| Server Action 인가 실패 (admin 아님) | 403 + toast "권한이 없습니다" |

## 10. 테스트 전략 (TDD, 80%+)

| 레이어 | 종류 | 도구 | 핵심 케이스 |
|---|---|---|---|
| `shared/lib/docker/parseContainer` | unit | Vitest + Zod | 라벨 CSV 파싱, port 파싱, missing label = null, malformed → throw |
| `entities/container/api/listContainers` | unit | Vitest, mock execFile | NDJSON 파싱, 빈 결과, daemon timeout, 1줄 skip |
| `entities/project/api/getProjects` | integration | 실제 PostgreSQL | host isolation, isHidden 필터, unique constraint |
| `entities/project/api/upsertProjectFromContainer` | integration | DB | 자동 생성, 멱등성 |
| `features/container-actions/restartContainer` | integration | mock docker CLI + DB | success → audit INSERT, failed → status=failed, 비admin → reject |
| `features/container-list/groupByProject` | unit | pure function | standalone 분리, hidden 제외, pinned 우선 |
| `widgets/server-overview` | RSC component | Vitest + RTL | 빈 호스트, 부분 다운, daemon 끊김 배너 |
| 메인 → 상세 → restart | E2E | Playwright | 전체 흐름. mock docker daemon shim. |

E2E mock 전략: `process.env.DOCKER_HOST_MOCK_DIR`를 보고 fixture NDJSON을 반환하는
shim 스크립트. 실제 daemon 의존성 없이 흐름 검증.

## 11. 보안

### 11.1 인증/인가

- **Read**: 인증된 NextAuth 사용자 누구나.
- **Action (restart/start/stop)**: `env.ADMIN_EMAILS` (CSV) allowlist만.
- **Host 관리**: v0.1엔 UI 없음 (seed 기반). v0.2에서 별도.

### 11.2 입력 검증

- 모든 Server Action은 Zod 입력 검증.
- `containerId`: `^[a-f0-9]{12,64}$` 정규식 강제.
- `hostId`: UUID schema.
- `dockerContext`는 사용자 입력 신뢰 안 함 — 항상 DB의 `hosts.dockerContext`에서 조회.

### 11.3 명령 안전성

- `execFile('docker', [args...])`만 사용. shell 보간/`exec()` 절대 금지.

### 11.4 시크릿 마스킹

inspect 결과의 `Env`를 모달 표시할 때:
- 키가 `*KEY*|*SECRET*|*TOKEN*|*PASSWORD*|*DSN*|*URL*`에 매칭되면 값 `***`.
- 화이트리스트 키만 평문 (`NODE_ENV`, `PORT` 등). 의심스러우면 마스킹.

### 11.5 Audit log

- 모든 액션 (성공/실패) 기록.
- 호스트 상세 페이지 하단에 최근 5건 가시화 (투명성).

### 11.6 환경 변수 (Zod 검증)

```
ADMIN_EMAILS=krdn.net@gmail.com
DOCKER_DEFAULT_CONTEXT=home-server
DOCKER_CMD_TIMEOUT_MS=10000
```

`shared/config/env.ts`의 schema에 추가. 시작 시 누락 검증.

## 12. 비기능 요구사항

| 항목 | 목표 |
|---|---|
| 메인 SSR 응답 | < 800ms (docker list 1회 포함) |
| 호스트 상세 SSR | < 1.2s |
| 액션 응답 | 5s 내, 그렇지 않으면 백그라운드 메시지 |
| Docker CLI timeout | 10s |
| 컨테이너 ~30개에서 list 1회 | < 500ms (네트워크 포함) |

## 13. 배포 & 마이그레이션

1. Drizzle 마이그레이션: `hosts`, `projects`, `audit_logs` 추가 (`db:generate` → `db:migrate`).
2. Seed 스크립트: `home-server` 1대 등록 (`src/scripts/seed-hosts.ts`).
3. 환경 변수 추가: `ADMIN_EMAILS`, `DOCKER_DEFAULT_CONTEXT`, `DOCKER_CMD_TIMEOUT_MS`.
4. 운영 배포 후 첫 RSC 호출 시 `projects` lazy upsert로 자동 채워짐.
5. CLAUDE.md의 컨테이너 표는 손대지 않음 — 이 도구가 그 표의 동적 버전이 됨.

## 14. v0.2 후보 (out of scope)

- L2 리소스 메트릭: `docker stats` 주기적 수집 + (시계열은 우선 메모리 또는 단기 DB)
- L3 로그 패턴 분석: ERROR/FATAL 자동 감지 + Web Push
- L4 의존성 진단: project 내 service 그래프, restart 루프 감지
- 다중 호스트 등록 UI + 호스트 health check 페이지
- 컨테이너 상세 모달의 라이브 로그 tail 보기
- TimescaleDB 연동 (이미 운영 중인 `krdn-timescaledb` 활용)

## 15. 출시 순서 (구현 단계)

상세는 `writing-plans` 단계에서 작성. 큰 흐름은:

1. Drizzle 스키마 + 마이그레이션 + seed
2. shared/lib/docker (CLI 어댑터, parser, Zod schemas) — TDD
3. entities (host, project, container) — 각각 TDD
4. features/container-list groupByProject — pure function TDD
5. features/container-actions Server Actions + audit log — TDD + integration
6. widgets/server-overview RSC + TanStack Query polling
7. /servers/[hostName] 페이지
8. E2E (Playwright + docker mock shim)
9. RUNBOOK 갱신 + dogfooding 체크리스트
