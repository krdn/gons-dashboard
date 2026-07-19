# 실시간 관제 Phase 1 구현 계획 (이슈 #323)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 호스트 Vitals(에이전트 push) + docker stats + 앱 cron 실행 기록 + 이벤트 타임라인을 수집·저장·표시하는 "실시간 상태 확인"의 최소 완성형을 구축한다.

**Architecture:** 호스트 에이전트(bash+systemd)가 15초마다 `/api/agent/metrics-ingest`(Bearer)로 vitals를 push하고, cron 컨테이너가 1분마다 `/api/cron/collect-docker-stats`로 컨테이너 지표를 수집한다. 모든 지표는 `metric_samples`에, 임계값 위반은 수집 시점 인라인 평가로 `monitoring_events`에, 앱 cron 실행은 `createCronHandler` 계측으로 `cron_runs`에 기록된다. `/monitoring` 페이지(15초 폴링, RSC refresh)와 홈 요약 위젯, 왼쪽 메뉴 항목을 추가한다.

**Tech Stack:** Next.js 16 RSC, Drizzle ORM, Zod, Vitest, bash+systemd(호스트 에이전트), node-cron(기존 scheduler).

**디자인 방향 선언 (gon:dashboard-design Step 0-1):** Operational 대시보드. 기존 라이트 토큰 체계(`--color-severity-*`) 위의 data-dense minimalism — 채도는 상태 신호(ok/warning/critical)에만, 숫자는 `tabular-nums`, KPI 3-5개 + Vitals 히어로 + 테이블/타임라인 드릴다운 순의 시선 흐름.

## Global Constraints

- FSD 의존 방향: `app → widgets → features → entities → shared`. entities 간 직접 참조 금지. shared는 entities를 import할 수 없다(→ cron_runs 기록은 shared/lib/cron 내부에서 db 직접 사용).
- 새 필수 env `METRICS_INGEST_TOKEN` 은 **4곳 동시 추가**: `env.ts`, `.env.example`, `apps/dashboard/Dockerfile` placeholder ENV 블록, `.github/workflows/ci.yml` (Test env + Build env 두 블록). `MCP_DASHBOARD_TOKEN` 전례를 그대로 미러.
- 신규 페이지 `/monitoring` 은 per-page `auth()` 가드 + `export const dynamic = "force-dynamic"` 필수 (layout엔 가드 없음).
- 클라이언트 표시 시각은 locale-free `HH:MM:SS` (Gotcha #3 hydration).
- 운영 DB 마이그레이션은 psql 수동 선적용 후 이미지 배포 (Gotcha #2 — 배포 단계에서).
- 수집 cron(collect-docker-stats, monitoring-purge)은 scheduler catchup 대상에 **추가하지 않는다** (이슈 주의점 7).
- 관측은 best-effort: `recordCronRun` 실패가 cron 응답을 뒤집으면 안 된다 (try/catch swallow + logger.warn).
- PR 전 `pnpm build` 1회 필수 (Gotcha #7).
- 커밋은 태스크 단위, 브랜치 `feat/monitoring-phase1`.

## 이슈 #323 대비 범위 결정 (기록)

- `events` 물리 테이블명은 `monitoring_events` (범용 명칭 충돌 회피).
- cron_runs 계측은 `createCronHandler` 사용 라우트 9종만. 비-factory 3종(autopilot-cycle/notify, krx-master-sync)은 Phase 2.
- critical 임계값은 이슈의 warning 임계값 위에 한 단계 추가(cpu 97/mem 95/disk 95/temp 90/gpu.temp 90) — 홈 요약의 red 신호원 확보.
- 알림 발송(텔레그램/web-push)은 Phase 1 제외 — 이벤트 기록·표시까지만.
- 보존: metric_samples 48h / cron_runs 30d / resolved 이벤트 90d (`monitoring-purge` cron).
- 다운샘플(5분 집계)은 Phase 4.

## 파일 구조

```
apps/dashboard/src/
├── shared/lib/db/schema/monitoring.ts          # 신규: metricSamples, cronRuns, monitoringEvents
├── shared/lib/cron/recordCronRun.ts            # 신규: best-effort cron_runs insert
├── shared/lib/cron/createCronHandler.ts        # 수정: 계측 2줄
├── shared/lib/docker/parseDockerStats.ts       # 신규: docker stats json 파서
├── shared/config/env.ts                        # 수정: METRICS_INGEST_TOKEN
├── shared/config/navigation.ts                 # 수정: monitoring leaf
├── shared/ui/icons.tsx                         # 수정: MonitoringIcon
├── entities/monitoring/
│   ├── model/types.ts                          # 타입
│   ├── api/samples.ts                          # insert/조회
│   ├── api/events.ts                           # record/resolve/조회
│   ├── api/cronRuns.ts                         # 보드 조회
│   └── server.ts                               # 진입점 (server-only)
├── features/monitoring-ingest/
│   ├── model/vitalsSchema.ts                   # zod payload
│   ├── lib/flattenVitals.ts                    # payload → samples[]
│   ├── lib/evaluateVitals.ts                   # 임계값 평가 (pure)
│   └── index.ts                                # ingestVitals 오케스트레이션
├── widgets/monitoring/
│   ├── hooks/useAutoRefresh.ts                 # host-dashboard 훅 복제(12줄, 위젯 간 import 회피)
│   ├── ui/AutoRefresh.tsx                      # "use client" router.refresh 폴링
│   ├── ui/StatusDot.tsx / SeverityBadge.tsx    # 상태 표시 공용
│   ├── ui/VitalsBoard.tsx                      # 히어로
│   ├── ui/ContainerStatsBoard.tsx
│   ├── ui/CronRunsBoard.tsx
│   ├── ui/EventsTimeline.tsx
│   ├── ui/MonitoringSummaryCard.tsx            # 홈 aside 요약
│   └── index.ts
├── widgets/app-shell/navIcon.tsx               # 수정: 매핑 1줄
├── app/(dashboard)/monitoring/page.tsx         # 신규 페이지 (auth 가드)
├── app/(dashboard)/monitoring/loading.tsx      # skeleton
├── app/_widgets/registry.ts                    # 수정: 요약 위젯 aside 최상단
├── app/api/agent/metrics-ingest/route.ts       # 신규
├── app/api/cron/collect-docker-stats/route.ts  # 신규
└── app/api/cron/monitoring-purge/route.ts      # 신규
apps/cron/scheduler.js                          # 수정: 잡 2개
scripts/monitoring-agent/
├── agent.sh                                    # 호스트 에이전트
├── gons-monitoring-agent.service               # systemd 유닛
└── README.md                                   # 설치 절차
apps/dashboard/drizzle/0046_*.sql               # drizzle-kit generate
```

메트릭 이름 카탈로그(고정): `cpu.pct` `load.1/.5/.15` `mem.used_pct` `swap.used_mb` `disk.used_pct{mount}` `disk.inode_pct{mount}` `temp.cpu_c` `gpu.util_pct` `gpu.vram_pct` `gpu.temp_c` `net.rx_bps{iface}` `net.tx_bps{iface}` `uptime.sec` `reboot.required` / `container.cpu_pct{container}` `container.mem_pct{container}` `container.mem_used_mb{container}`.

---

### Task 1: DB 스키마 + 마이그레이션

**Files:**
- Create: `apps/dashboard/src/shared/lib/db/schema/monitoring.ts`
- Modify: `apps/dashboard/src/shared/lib/db/schema/index.ts` (export 1줄)
- Generate: `apps/dashboard/drizzle/0046_*.sql`

**Interfaces (Produces):** `metricSamples`, `cronRuns`, `monitoringEvents` 테이블 객체.

- [ ] **Step 1: 스키마 작성**

```ts
// 관제(monitoring) 도메인 — 이슈 #323 Phase 1.
// metric_samples: 시계열 원본(48h 보존 — monitoring-purge cron). 쓰기 빈도 높음.
// cron_runs: createCronHandler 계측 결과 (30d 보존).
// monitoring_events: 임계값 위반 이벤트 (dedup_key로 open 이벤트 중복 억제).
import {
  pgTable, text, timestamp, integer, uuid, index, jsonb, real, boolean,
} from "drizzle-orm/pg-core";
import { hosts } from "./infra";

export const metricSamples = pgTable(
  "metric_samples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id").notNull().references(() => hosts.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    value: real("value").notNull(),
    labels: jsonb("labels").$type<Record<string, string>>(),
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("metric_samples_host_metric_time_idx").on(t.hostId, t.metric, t.collectedAt.desc()),
    index("metric_samples_time_idx").on(t.collectedAt), // purge 용
  ],
);

export const cronRuns = pgTable(
  "cron_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job: text("job").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    status: text("status").notNull(), // 'ok' | 'partial' | 'error'
    total: integer("total").notNull(),
    succeeded: integer("succeeded").notNull(),
    failed: integer("failed").notNull(),
  },
  (t) => [index("cron_runs_job_time_idx").on(t.job, t.startedAt.desc())],
);

export const monitoringEvents = pgTable(
  "monitoring_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(), // 'host' | 'container' | 'cron' | ...
    severity: text("severity").notNull(), // 'critical' | 'warning' | 'info'
    title: text("title").notNull(),
    detail: text("detail"),
    dedupKey: text("dedup_key").notNull(),
    hostId: uuid("host_id").references(() => hosts.id, { onDelete: "cascade" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("monitoring_events_dedup_idx").on(t.dedupKey, t.occurredAt.desc()),
    index("monitoring_events_time_idx").on(t.occurredAt.desc()),
  ],
);
```

- [ ] **Step 2:** `schema/index.ts`에 `export * from "./monitoring";` 추가.
- [ ] **Step 3:** `cd apps/dashboard && pnpm db:generate` → `0046_*.sql` 생성 확인 (`CREATE TABLE metric_samples/cron_runs/monitoring_events` 3개 포함).
- [ ] **Step 4:** `pnpm typecheck` 통과 확인 후 커밋 `feat: 관제 스키마 3테이블 추가 (metric_samples/cron_runs/monitoring_events)`.

### Task 2: 임계값 평가 + payload 스키마 (pure, TDD)

**Files:**
- Create: `features/monitoring-ingest/model/vitalsSchema.ts`, `lib/flattenVitals.ts`, `lib/evaluateVitals.ts`
- Test: `features/monitoring-ingest/lib/evaluateVitals.test.ts`, `lib/flattenVitals.test.ts` (co-located)

**Interfaces (Produces):**
- `vitalsPayloadSchema` (zod), `type VitalsPayload = z.infer<...>`
- `flattenVitals(hostId: string, p: VitalsPayload, collectedAt: Date): NewMetricSample[]`
- `evaluateVitals(p: VitalsPayload): VitalsVerdict[]` — `{ dedupKeySuffix: string; violated: boolean; severity: "critical"|"warning"; title: string; detail?: string }`

- [ ] **Step 1: zod payload**

```ts
import { z } from "zod";

export const vitalsPayloadSchema = z.object({
  host: z.string().min(1),
  collectedAt: z.string().datetime({ offset: true }).optional(),
  cpuPct: z.number().min(0).max(100),
  load1: z.number().min(0), load5: z.number().min(0), load15: z.number().min(0),
  memUsedPct: z.number().min(0).max(100),
  swapUsedMb: z.number().min(0),
  disks: z.array(z.object({
    mount: z.string().min(1),
    usedPct: z.number().min(0).max(100),
    inodePct: z.number().min(0).max(100).optional(),
  })).max(20),
  cpuTempC: z.number().optional(),
  gpu: z.object({
    utilPct: z.number().min(0).max(100),
    vramPct: z.number().min(0).max(100),
    tempC: z.number(),
  }).optional(),
  net: z.array(z.object({ iface: z.string().min(1), rxBps: z.number().min(0), txBps: z.number().min(0) })).max(10).optional(),
  uptimeSec: z.number().min(0),
  rebootRequired: z.boolean(),
});
export type VitalsPayload = z.infer<typeof vitalsPayloadSchema>;
```

- [ ] **Step 2: 실패 테스트 작성** — evaluateVitals: cpu 92 → warning 1건(dedupKeySuffix "cpu"), cpu 98 → critical, 전부 정상 → 모든 verdict violated=false, disk mount별 verdict 분리, rebootRequired → warning, gpu 없으면 gpu verdict 없음. flattenVitals: 표준 payload → 메트릭 이름·labels·값 정확성.
- [ ] **Step 3: 구현.** 임계값 표 (이슈 §2-A 계승 + critical 확장):

```ts
// (경고, 위험) — 이슈 #323 §2-A 임계값 + critical 단계 확장.
const CPU = { warn: 90, crit: 97 };
const MEM = { warn: 90, crit: 95 };
const DISK = { warn: 85, crit: 95 };
const TEMP = { warn: 80, crit: 90 };
const GPU_VRAM = { warn: 90, crit: 97 };
const GPU_TEMP = { warn: 85, crit: 90 };
```

verdict는 값이 존재하는 항목마다 항상 반환(violated boolean) — 호출부가 violated=false를 resolve 신호로 사용. dedupKeySuffix: `cpu`, `mem`, `disk:{mount}`, `temp`, `gpu.vram`, `gpu.temp`, `reboot`.
- [ ] **Step 4:** `pnpm vitest run src/features/monitoring-ingest` 통과("N passed" 확인 — vitest include 함정), 커밋 `feat: 관제 vitals 스키마·평가·평탄화 (pure)`.

### Task 3: 이벤트 record/resolve + 샘플 insert (entities)

**Files:**
- Create: `entities/monitoring/model/types.ts`, `api/samples.ts`, `api/events.ts`, `server.ts`
- Test: `apps/dashboard/tests/monitoring-events.test.ts` (test DB 통합 — host-api.test.ts 패턴)

**Interfaces (Produces):**
- `insertMetricSamples(rows: NewMetricSample[]): Promise<number>`
- `recordEvent(e: { source; severity; title; detail?; dedupKey; hostId? }): Promise<void>` — open(resolvedAt null) 동일 dedupKey 존재 시: severity 같으면 skip, 다르면 severity/title/detail UPDATE (에스컬레이션).
- `resolveEvent(dedupKey: string): Promise<void>` — open 이벤트 resolvedAt=now.
- `listRecentEvents(limit=50)`, `countOpenEvents(): Promise<{ critical: number; warning: number }>`
- `getRecentSamples(since: Date)` — 윈도 조회(보드용).

- [ ] **Step 1:** 실패 테스트(test DB): record → open 1건, 재record skip, severity 상승 시 UPDATE, resolve 후 재record는 신규 insert, countOpenEvents 집계.
- [ ] **Step 2:** 구현 (drizzle `and(eq(dedupKey), isNull(resolvedAt))` 패턴).
- [ ] **Step 3:** 로컬 test DB 기동 + `DATABASE_URL=<testdb> pnpm db:migrate` 선적용 후 `pnpm vitest run tests/monitoring-events.test.ts` 통과, 커밋 `feat: 관제 이벤트 dedup 기록·해소 + 샘플 저장`.

### Task 4: metrics-ingest API + env 토큰 4곳

**Files:**
- Create: `app/api/agent/metrics-ingest/route.ts`, `features/monitoring-ingest/index.ts`
- Modify: `shared/config/env.ts`, `apps/dashboard/.env.example`, `apps/dashboard/Dockerfile`(placeholder ENV), `.github/workflows/ci.yml`(Test/Build env), `apps/dashboard/.env`(로컬 dev 값)
- Test: `apps/dashboard/tests/integration/metrics-ingest.test.ts` (memo-ingest 테스트 미러 — db mock)

**Interfaces:**
- Consumes: `vitalsPayloadSchema`, `flattenVitals`, `evaluateVitals`(Task 2), `insertMetricSamples`/`recordEvent`/`resolveEvent`(Task 3).
- Produces: `POST /api/agent/metrics-ingest` — 401/400/404(unknown host)/200 `{ inserted }`. `features/monitoring-ingest`의 `ingestVitals(payload): Promise<{ inserted: number }>`.

- [ ] **Step 1:** env 4곳 추가 — `env.ts`: `METRICS_INGEST_TOKEN: z.string().min(32, "openssl rand -hex 32 로 생성")` (MCP_DASHBOARD_TOKEN 옆), Dockerfile ENV 블록·ci.yml Test/Build env에 `METRICS_INGEST_TOKEN=a-placeholder-metrics-token-of-at-least-32-chars`, `.env.example`에 빈 항목+주석, 로컬 `.env`에 실값 생성(`openssl rand -hex 32`).
- [ ] **Step 2:** 실패 테스트 작성 — 401(토큰 불일치), 400(zod 불통), 404(hosts에 없는 host명), 200(inserted 수 + recordEvent 호출 여부: cpu 98 payload → critical record).
- [ ] **Step 3:** `ingestVitals` 구현 — host명 → hosts 조회, flatten insert, verdict 순회: violated ? recordEvent(`host:{hostId}:{suffix}`) : resolveEvent(동일 키). **이벤트 기록 실패는 best-effort** (샘플 저장 성공을 뒤집지 않게 try/catch + logger.warn). route는 memo-ingest 미러: `verifyBearer(req, env.METRICS_INGEST_TOKEN)` → JSON parse → zod → ingestVitals → `Response.json({ inserted }, { headers: NO_STORE })`.
- [ ] **Step 4:** 테스트 통과 + `pnpm typecheck` 후 커밋 `feat: metrics-ingest API — 호스트 vitals 수집 입구`.

### Task 5: 호스트 에이전트 (bash + systemd)

**Files:**
- Create: `scripts/monitoring-agent/agent.sh`(실행권한), `gons-monitoring-agent.service`, `README.md`

**Interfaces:** env `DASHBOARD_URL`(기본 http://localhost:3020), `METRICS_INGEST_TOKEN`(필수), `HOST_NAME`(기본 hostname — hosts.name과 일치 필요), `INTERVAL_SEC`(기본 15). `--once`는 1회 수집·전송 후 종료(스모크용), `--dry-run`은 payload 출력만.

- [ ] **Step 1:** agent.sh 작성 — 루프 방식(직전 /proc/stat·net 카운터로 delta 계산). 수집: `/proc/stat`(cpu), `/proc/loadavg`, `/proc/meminfo`(MemAvailable·Swap), `df -P --output=target,pcent -x tmpfs -x devtmpfs -x overlay -x squashfs`(+`df -Pi` inode), hwmon 최대 온도, `nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits`(있을 때만), `/proc/net/dev`(lo 제외, bps 계산), `/proc/uptime`, `/var/run/reboot-required` 존재. printf로 JSON 조립(수치·고정 키만이라 escape 불필요, mount는 소독: 공백·따옴표 포함 마운트 skip). curl `-fsS -m 10` POST, 실패는 stderr 1줄(치명 아님).
- [ ] **Step 2:** systemd 유닛 — `EnvironmentFile=/etc/default/gons-monitoring-agent`, `Restart=always`, `RestartSec=10`.
- [ ] **Step 3:** README — 설치 3단계(스크립트 복사 → env 파일 mode 600 → enable --now), 토큰은 운영 .env의 `METRICS_INGEST_TOKEN`과 동일 값 지시(값 자체는 문서에 미기재).
- [ ] **Step 4:** 로컬 스모크: dev 서버 기동 상태에서 `METRICS_INGEST_TOKEN=<dev값> HOST_NAME=<dev hosts.name> ./scripts/monitoring-agent/agent.sh --once` → 200 + metric_samples row 확인. 커밋 `feat: 호스트 vitals 수집 에이전트 (bash+systemd)`.

### Task 6: docker stats 파서 + 수집 cron

**Files:**
- Create: `shared/lib/docker/parseDockerStats.ts`, `app/api/cron/collect-docker-stats/route.ts`
- Modify: `shared/lib/docker/index.ts`(barrel), `apps/cron/scheduler.js`(잡 1개)
- Test: `apps/dashboard/tests/docker-parse-stats.test.ts`

**Interfaces:**
- `parseDockerStats(line: string): { name: string; cpuPct: number; memPct: number; memUsedMb: number } | null` — `docker stats --no-stream --format "{{json .}}"` 한 줄 입력. `"1.23%"`→1.23, `"6.204GiB / 62.71GiB"`→6353(MB, KiB/MiB/GiB/TiB 지원). malformed → null.
- `POST /api/cron/collect-docker-stats` — createCronHandler, targetSelect=active hosts, perTarget: `runDocker(context, ["stats","--no-stream","--format","{{json .}}"])` → 파싱 → `insertMetricSamples`(labels `{container}`), payload `{ containers }`.

- [ ] **Step 1:** 파서 실패 테스트(GiB/MiB 변환, %, malformed null) → 구현 → 통과.
- [ ] **Step 2:** 라우트 작성 (stock-analyze 라우트 구조 미러).
- [ ] **Step 3:** scheduler.js에 매분 잡 추가 — `* * * * *`, timeout 50_000, catchup 미포함 주석 명시.
- [ ] **Step 4:** `pnpm typecheck && pnpm lint` 후 커밋 `feat: docker stats 매분 수집 cron`.

### Task 7: cron_runs 계측 (createCronHandler)

**Files:**
- Create: `shared/lib/cron/recordCronRun.ts`
- Modify: `shared/lib/cron/createCronHandler.ts`
- Test: `shared/lib/cron/createCronHandler.test.ts` 확장 + `recordCronRun` 단위 테스트

**Interfaces:**
- `recordCronRun(r: { job; startedAt: Date; finishedAt: Date; status: "ok"|"partial"|"error"; total; succeeded; failed }): Promise<void>` — 내부 try/catch swallow + `logger.warn` (관측 best-effort).
- createCronHandler: bearer 통과 직후 `startedAt` 캡처, envelope 작성 후 `await recordCronRun({...})` 1회. status: failed=0→"ok", succeeded>0&&failed>0→"partial", 그 외 failed>0→"error". 401·targetSelect fatal은 기록 안 함(한계 — Phase 2 스케줄 기대치 비교로 보완).

- [ ] **Step 1:** 실패 테스트 — recordCronRun 모듈 vi.mock으로 계측 호출 인자 검증(성공/부분실패/전건실패 3케이스) + db throw 시 envelope 200 유지.
- [ ] **Step 2:** 구현 → 기존 테스트 전부 + 신규 통과 확인.
- [ ] **Step 3:** 커밋 `feat: 앱 cron 실행 기록 계측 (cron_runs)`.

### Task 8: monitoring-purge cron

**Files:**
- Create: `app/api/cron/monitoring-purge/route.ts`
- Modify: `apps/cron/scheduler.js`(잡 1개)

**Interfaces:** createCronHandler, targets 고정 3건 `[{id:"metric_samples"},{id:"cron_runs"},{id:"monitoring_events"}]`, perTarget: 각각 `collected_at < now()-48h` / `started_at < now()-30d` / `resolvedAt not null and occurred_at < now()-90d` DELETE, payload `{ deleted }`. 스케줄 `17 3 * * *` KST, catchup 미포함.

- [ ] **Step 1:** 라우트 구현 (drizzle `lt(...)` delete + `.returning({ id })` 대신 count는 `rowCount` — drizzle delete는 `.execute()` 결과 사용).
- [ ] **Step 2:** typecheck/lint 후 커밋 `feat: 관제 데이터 보존 정책 purge cron`.

### Task 9: 조회 쿼리 (entities/monitoring 확장)

**Files:**
- Create: `entities/monitoring/api/cronRuns.ts`, samples.ts에 조회 추가
- Test: `apps/dashboard/tests/monitoring-queries.test.ts` (test DB)

**Interfaces (Produces — 위젯이 소비):**
- `getLatestHostMetrics(windowMs=180_000): Promise<HostMetricsSnapshot[]>` — `{ hostId, hostName, metrics: LatestMetric[], lastCollectedAt: Date | null }`; `LatestMetric = { metric, value, labels, collectedAt }` (window 조회 후 JS reduce, `container.` prefix 제외).
- `getLatestContainerStats(windowMs=180_000): Promise<ContainerStatRow[]>` — `{ hostName, container, cpuPct, memPct, memUsedMb, collectedAt }`.
- `listCronRunBoard(): Promise<CronRunBoardRow[]>` — job별 최신 1건(DISTINCT ON) + 24h `runs/failures` 집계, `{ job, lastRunAt, lastStatus, lastDurationMs, runs24h, failures24h }`.

- [ ] **Step 1:** 실패 테스트(test DB에 샘플/런 심고 스냅샷·보드 검증) → 구현(hosts join, `sql` template DISTINCT ON) → 통과.
- [ ] **Step 2:** 커밋 `feat: 관제 보드 조회 쿼리`.

### Task 10: /monitoring 페이지 + 위젯 4종

**Files:**
- Create: `widgets/monitoring/*`(파일 구조 섹션 참조), `app/(dashboard)/monitoring/page.tsx`, `loading.tsx`

**Interfaces:**
- Consumes: Task 9 쿼리 + `listRecentEvents`/`countOpenEvents`(Task 3).
- 페이지가 `Promise.all`로 페치 → 프레젠테이션 위젯에 props 주입. `AutoRefresh intervalMs={15_000}`.

**디자인 스펙 (dashboard-design Step 3-5):**
- KPI 스트립 4개: 전체 상태(StatusDot green/yellow/red — open critical→red, warning→yellow), 미해결 이벤트 수, CPU 사용률, 디스크 최대 사용률. `tabular-nums`, 값이 주인공.
- 히어로: VitalsBoard 2/3폭 (CPU+load / MEM+swap / disk mount별 / temp / GPU / uptime·reboot 타일) — 수집 60초 초과 시 "수집 중단됨" 경고 상태(에이전트 다운 감지).
- ContainerStatsBoard: CPU desc 정렬 테이블, 숫자 우측 정렬.
- CronRunsBoard: job·최종 실행(HH:MM:SS)·상태 배지·소요·24h 실패/실행.
- EventsTimeline: 최근 50건, severity 색+아이콘+텍스트 병행(색만으로 전달 금지), resolved는 취소선 아님 — muted + "해소" 배지.
- 상태색은 기존 토큰만: `--color-severity-ok/med/high`, warning은 `--color-warn`. empty/loading(스켈레톤)/stale 상태 전부 구현.

- [ ] **Step 1:** 공용 소품(StatusDot, SeverityBadge, formatKstTime — locale-free HH:MM:SS) + 보드 4종 + 요약 카드 구현.
- [ ] **Step 2:** 페이지 조립 — auth 가드 + force-dynamic + KPI 스트립 + 보드 배치(grid, Vitals 히어로 2/3 + 타임라인 1/3, 이하 전체폭 테이블).
- [ ] **Step 3:** 렌더 단위 테스트 1개(EventsTimeline: severity 라벨·해소 배지 렌더 — jsdom) 통과, `pnpm typecheck && pnpm lint` 후 커밋 `feat: /monitoring 관제 페이지 + 보드 위젯 4종`.

### Task 11: 홈 요약 위젯 + registry

**Files:**
- Create: `widgets/monitoring/ui/MonitoringSummaryCard.tsx` (self-fetch async RSC — 홈 위젯 패턴), `MonitoringSummarySkeleton`
- Modify: `app/_widgets/registry.ts` — aside 최상단 `{ id: "monitoring-summary", column: "aside", Component: MonitoringSummaryCard, Skeleton: MonitoringSummarySkeleton }`

내용: StatusDot + "관제" 제목 + open critical/warning 수 + 마지막 수집 시각 + `/monitoring` 링크. 데이터 없으면 "수집 대기 중" empty 상태.

- [ ] **Step 1:** 구현 + registry 등록, typecheck 후 커밋 `feat: 홈 관제 요약 위젯`.

### Task 12: 왼쪽 메뉴

**Files:**
- Modify: `shared/config/navigation.ts` — `NavIconKey`에 `"monitoring"`, NAV_TREE 홈 바로 아래 `{ kind: "leaf", href: "/monitoring", label: "관제", icon: "monitoring" }`
- Modify: `shared/ui/icons.tsx` — `MonitoringIcon` (activity pulse: `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />`)
- Modify: `widgets/app-shell/navIcon.tsx` — import + MAP `monitoring: MonitoringIcon`
- Test: `apps/dashboard/tests/sidebar-nav-tree.test.tsx` 갱신

UI/UX 근거: 관제는 고빈도 조회(Operational) → 그룹에 숨기지 않고 홈 직하 top-level leaf. 최상위 4개(홈/관제/Claude Code/개인)로 IA 상한(5-7) 내. active 3중 신호는 기존 Sidebar가 처리.

- [ ] **Step 1:** 3파일 수정 + nav 테스트 갱신·통과, 커밋 `feat: 왼쪽 메뉴에 관제 항목 추가`.

### Task 13: 전체 검증 + 리뷰 + PR

- [ ] **Step 1:** `pnpm typecheck && pnpm lint`
- [ ] **Step 2:** test DB 기동 + 마이그레이션 선적용 후 `TEST_DATABASE_URL=... pnpm test` 전체 green
- [ ] **Step 3:** `cd apps/dashboard && pnpm build` (Gotcha #7)
- [ ] **Step 4:** dev 서버 dogfood 스모크 — `/monitoring` 200, 에이전트 `--once` push 반영 확인
- [ ] **Step 5:** CLAUDE.md 갱신 — 도메인 목록에 관제 1줄 + 환경 변수 표에 `METRICS_INGEST_TOKEN`
- [ ] **Step 6:** Codex 리뷰 (`~/.claude/scripts/codex-review.sh`, 정적 리뷰 — 검증 재실행 금지 명시) → 지적 반영
- [ ] **Step 7:** PR 생성 (베이스 main, 이슈 #323 링크) + auto-merge. **배포는 별도 단계**: psql로 0046 선적용 → 이미지 교체 → 운영 .env에 `METRICS_INGEST_TOKEN` + compose environment 나열 → 호스트 에이전트 설치.

## Self-Review 체크

- 이슈 Phase 1 4축(vitals/stats/cron_runs/events+타임라인) ↔ Task 1-10 매핑 완료. 메뉴(사용자 추가 요청) = Task 12. 요약 위젯 = Task 11(이슈 §3 표시).
- 타입 일관성: `NewMetricSample`(Task 1 스키마 $inferInsert) ← Task 2 flatten ← Task 3 insert ← Task 4/6 사용. verdict suffix ↔ dedupKey 조립은 Task 4에만 존재(단일 지점).
- placeholder 없음 — 코드 미기재 구간(위젯 TSX 세부)은 디자인 스펙 + props 계약으로 실행자(본 세션)가 직접 구현.
