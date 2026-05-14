# Cron 핸들러 셰이프 deepening — Design Spec

- **Date**: 2026-05-15
- **Scope**: 세 cron route(`poll-gmail`, `morning-digest`, `generate-daily-fortunes`)가 공유하는 동일 골격 (bearer → 활성 대상 select → per-target 작업 + 부분 실패 격리 → 결과 집계 → JSON 응답) 을 단일 `createCronHandler` 팩토리로 묶는다.
- **Non-goals**: 친구션 #1 (캐시-리딩 모듈) 은 이미 완료 (PR #55, 운영 적용 완료). 친구션 #3 (entities barrel server-only 누출), #4 (listContainers 가시성) 는 본 spec 범위 밖.
- **Status**: design grilling 완료 (2026-05-15 `/improve-codebase-architecture` 세션, 친구션 #2).
- **Prerequisite**: 친구션 #1 (PR #55) 머지 + 운영 적용 완료. main 에 새 cachedReading 모듈 + 0009 마이그레이션 반영.

## 1. 배경 — 친구션 #2 (deepening 후보 survey 결과)

`app/api/cron/{poll-gmail,morning-digest,generate-daily-fortunes}/route.ts` 세 핸들러가 *동일한 5단계 골격* 을 베껴 쓴다.

### 1.1 공통 골격

```
1. verifyCronBearer(request) → 401 (auth)
2. 활성 대상 select (drizzle query)
3. per-target work + 부분 실패 격리
4. 결과 집계 (per-target status + payload)
5. NextResponse.json (envelope)
```

### 1.2 현재 불일치 — deepening 의 *진짜* 가치

| 단계 | `poll-gmail` | `morning-digest` | `generate-daily-fortunes` |
|---|---|---|---|
| 활성 대상 | `users.oauthState='active'` | 동일 | `fortuneProfiles.isActive=true × sajuCharts INNER JOIN` |
| 부분 실패 격리 | `for + try/catch` per-user | `for` (try 없음) | `Promise.allSettled` (병렬, 무제한) |
| 에러 메시지 절단 | 안 함 (raw) | 안 함 | `slice(0, 200)` |
| 응답 envelope 키 | `{runAt, activeUsers, reauthRequired, results}` | `{runAt, timezone, activeUsers, results}` | `{forDate, total, succeeded, failed, errors}` |
| `results` 항목 모양 | `{userId, email, kind, classifiedCount?, skippedCount?, error?}` | `{userId, email, itemCount, sent, expired, errors}` | (없음 — 카운트만) |

세 가지 *불일치* 가 운영 관점에서 비용을 만든다:

1. **격리 패턴 불일치** — `generate-daily-fortunes` 의 `Promise.allSettled` 는 *무제한 병렬*. LLM 호출이 N개 프로필 × 동시 시작 → Anthropic rate limit + 비용 burst.
2. **에러 메시지 폭주 위험** — 두 cron 은 raw message 그대로 응답에 박음. Docker stderr 같은 대량 텍스트가 cron 로그를 비대화.
3. **응답 envelope 불일치** — 운영자가 cron 별로 다른 키를 읽어야 함. 모니터링 도구를 한 가지 모양으로 못 짬.

### 1.3 Deletion test

깊은 모듈을 지우면:

- bearer 검사 5단계가 3개 route 에 재분산 (또는 N+1 cron 추가 시마다).
- 부분 실패 격리 정책이 cron 별로 또 다르게 누락.
- 에러 메시지 절단이 또 cron 별로 누락.
- 응답 envelope 일관성 영영 못 잡음.
- 새 cron(예: 주간 리포트, MCP 토큰 갱신) 추가 시마다 같은 5단계 + 동일한 *불일치 위험* 재현.

**복잡성이 N caller 로 흩어지고, 동시에 일관성 정책이 매번 누락 위험.** ✅ 통과.

## 2. 결정사항 (grilling 결과)

| ID | 결정 |
|---|---|
| **Q1** | (a) — `createCronHandler(definition)` 팩토리. 각 route 가 `export const POST = createCronHandler({...})` 한 줄. |
| **Q2** | (a) — `targetSelect: () => Promise<TTarget[]>` async 함수. drizzle 쿼리 자유. |
| **Q3** | (c) — target generic `<TTarget>` + `getId: (t) => string` + `getLabel?: (t) => string`. 모듈은 target 모양 모름. |
| **Q4** | (a) — 결과 envelope **완전 강제**. 운영 모니터링 일관성이 모듈의 존재 이유. |
| **Q5** | (c) — `concurrency?: number` 옵션, 기본 1 (순차). caller 가 cron 별 결정. |
| **Q6** | (a) — 에러 메시지 200자 절단 **강제**. `errorMaxLen` 옵션 없음 (YAGNI). |
| **Q7** | (a) — `apps/dashboard/src/shared/lib/cron/createCronHandler.ts`. 도메인 무관 — shared 가 자연. |
| **C-extra** | (c1) — `extra?: () => Promise<Record<string, unknown>>` 옵션 슬롯. cron-specific 글로벌 카운트 (예: `reauthRequired`) 흡수. |

## 3. 인터페이스 셰이프

### 3.1 모듈 위치

`apps/dashboard/src/shared/lib/cron/createCronHandler.ts` (신규)

### 3.2 Entry point (1개)

```ts
export function createCronHandler<TTarget, TPayload>(
  definition: CronHandlerDefinition<TTarget, TPayload>,
): (request: Request) => Promise<NextResponse>;
```

### 3.3 Definition 셰이프

```ts
export interface CronHandlerDefinition<TTarget, TPayload> {
  /** Cron 이름 — envelope `name` 슬롯 + 로그 prefix. */
  name: string;
  /** 활성 대상 select. drizzle 쿼리 자유. */
  targetSelect: () => Promise<TTarget[]>;
  /** Target → id 추출. envelope results[].id 슬롯. */
  getId: (target: TTarget) => string;
  /** Target → 사람 친화 label (예: email). optional. envelope results[].label 슬롯. */
  getLabel?: (target: TTarget) => string;
  /** Per-target 작업. throw → status='error' + 200자 절단 메시지. */
  perTarget: (target: TTarget) => Promise<TPayload>;
  /** 동시성. 기본 1 (순차). LLM cron 은 2~3, push 는 10 권장. */
  concurrency?: number;
  /** 글로벌 카운트 (target 단위 아닌 통계). envelope `extra` 슬롯. */
  extra?: () => Promise<Record<string, unknown>>;
}
```

### 3.4 응답 envelope (완전 강제)

```ts
export interface CronResultItem<TPayload> {
  id: string;
  label?: string;
  status: "ok" | "error";
  payload?: TPayload;   // status='ok' 일 때만
  error?: string;       // status='error' 일 때만, 200자 절단
}

export interface CronEnvelope<TPayload> {
  name: string;
  runAt: string;        // ISO timestamp
  timezone: string;     // process.env.TZ ?? "(unset)"
  total: number;
  succeeded: number;
  failed: number;
  results: CronResultItem<TPayload>[];
  extra?: Record<string, unknown>;
}
```

### 3.5 Invariants (모듈 doc comment 명시)

1. **bearer 검사**: `verifyCronBearer(request)` 실패 → 401 즉시 반환 (`targetSelect`/`perTarget`/`extra` 미호출).
2. **순서**: bearer → targetSelect → (병렬/순차 per-target work) → extra (optional) → JSON 응답.
3. **부분 실패 격리**: per-target throw 는 results[].status='error' 로 흡수. 다른 target 진행을 막지 않음. `targetSelect` 자체 throw 는 catch 안 함 (운영 fatal — 500).
4. **에러 메시지 절단**: 200자 강제. 모듈 정책, caller 변경 불가.
5. **Concurrency**: 정수 ≥1. 기본 1 (순차). target 수가 concurrency 보다 작으면 모든 target 동시 시작.
6. **응답 envelope**: 항상 위 셰이프. caller 가 추가 키 못 박음. cron-specific 데이터는 *반드시* payload 또는 extra 슬롯 안에.
7. **Server-only**: `"server-only"` import 강제.

### 3.6 무엇이 seam 뒤에 묻히나

caller 가 모르는 것 (모듈 내부):
- `verifyCronBearer` import + 401 분기
- `Promise.allSettled` vs `for-await` 분기 (concurrency 따라)
- `String(error).slice(0, 200)` 절단 정책
- `process.env.TZ ?? "(unset)"` 읽기
- `new Date().toISOString()` runAt 생성
- `succeeded`/`failed` 카운트 계산
- `NextResponse.json` 직렬화

caller 가 책임지는 것 (외부 seam):
- `targetSelect` query (drizzle 자유)
- `perTarget` 작업 자체 (`syncInbox`, `sendPush`, `generateDailyFortune` 등)
- `getId` / `getLabel` 추출 (target shape 의존)
- `concurrency` 정책 결정
- `extra` (글로벌 카운트, optional)

## 4. Concurrency 권장값 (cron 별)

| Cron | concurrency | 이유 |
|---|---|---|
| `poll-gmail` | 5 | Gmail history API per-user. rate limit 있지만 인당 1회 호출. 5 동시 안전. |
| `morning-digest` | 10 | DB read + Web Push. 네트워크 가벼움. 인당 push 1~2개. |
| `generate-daily-fortunes` | **2** (현재 무제한 → 감소) | LLM (Anthropic) 호출. rate limit + 비용 burst 위험. 2~3 권장. 일진은 자정 cron 이라 약간 늦어도 OK. |

`generate-daily-fortunes` 의 동시성 *감소* 가 deepening 의 부수 효과로 운영 안정성 *개선*.

## 5. Caller 리팩토링

### 5.1 `poll-gmail/route.ts`

```ts
export const POST = createCronHandler({
  name: "poll-gmail",
  targetSelect: async () => {
    return db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.oauthState, "active"));
  },
  getId: (u) => u.id,
  getLabel: (u) => u.email,
  perTarget: async (u) => {
    const result = await syncInbox(u.id);
    return {
      kind: result.kind,
      classifiedCount: result.classifiedCount,
      skippedCount: result.skippedCount,
    };
  },
  concurrency: 5,
  extra: async () => {
    const reauth = await db
      .select({ count: users.id })
      .from(users)
      .where(ne(users.oauthState, "active"))
      .then((r) => r.length);
    return { reauthRequired: reauth };
  },
});

export const dynamic = "force-dynamic";
```

`reauthRequired` 글로벌 카운트가 `extra` 슬롯으로 자연 흡수.

### 5.2 `morning-digest/route.ts`

```ts
export const POST = createCronHandler({
  name: "morning-digest",
  targetSelect: async () =>
    db.select({ id: users.id, email: users.email }).from(users).where(eq(users.oauthState, "active")),
  getId: (u) => u.id,
  getLabel: (u) => u.email,
  perTarget: async (u) => {
    const items = await getReplyNeeded(u.id, 5);
    if (items.length === 0) return { itemCount: 0, sent: 0, expired: 0, errors: 0 };

    const subs = await db
      .select({ endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, u.id));

    const title = `오늘 답장 필요 ${items.length}건`;
    const top = items[0];
    const body =
      items.length === 1
        ? `${top.fromName ?? top.fromEmail} — ${top.subject ?? "(제목 없음)"}`
        : `${top.fromName ?? top.fromEmail} 외 ${items.length - 1}건`;

    let sent = 0, expired = 0, errors = 0;
    const expiredEndpoints: string[] = [];
    for (const sub of subs) {
      const r = await sendPush(sub, { title, body, url: "/", tag: "morning-digest" });
      if (r.kind === "sent") sent += 1;
      else if (r.kind === "expired") { expired += 1; expiredEndpoints.push(r.endpoint); }
      else if (r.kind === "error") errors += 1;
    }
    if (expiredEndpoints.length > 0) {
      for (const endpoint of expiredEndpoints) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
      }
    }
    return { itemCount: items.length, sent, expired, errors };
  },
  concurrency: 10,
});

export const dynamic = "force-dynamic";
```

### 5.3 `generate-daily-fortunes/route.ts`

```ts
function kstTodayDate(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export const POST = createCronHandler({
  name: "generate-daily-fortunes",
  targetSelect: async () => {
    const rows = await db
      .select({ chart: sajuCharts })
      .from(fortuneProfiles)
      .innerJoin(sajuCharts, eq(sajuCharts.profileId, fortuneProfiles.id))
      .where(eq(fortuneProfiles.isActive, true));
    return rows;
  },
  getId: (r) => r.chart.id,
  getLabel: (r) => r.chart.profileId,
  perTarget: async (r) => {
    const result = await generateDailyFortune({ chartRow: r.chart, forDate: kstTodayDate() });
    return { cached: result.cached };
  },
  concurrency: 2,
  extra: async () => ({ forDate: kstTodayDate() }),
});

export const dynamic = "force-dynamic";
```

`forDate` 가 envelope 의 top-level 키 → `extra.forDate` 로 한 단계 내려감. 모니터링 도구 영향은 §7 회귀 위험.

## 6. 테스트 전략 — replace, don't layer

### 6.1 폐기 대상

- `tests/cron-poll-gmail.test.ts` (있다면), `tests/cron-morning-digest.test.ts`, `tests/cron-generate-daily-fortunes.test.ts` 의 *시퀀스 검증* (bearer 거부, 빈 대상, 일부 실패, 전부 실패) — `createCronHandler.test.ts` 로 이동.

(확인 필요: 현재 cron 테스트가 있는지 grep 으로 검증 단계에서)

### 6.2 신규 — `createCronHandler.test.ts`

| 시나리오 | 검증 |
|---|---|
| bearer 거부 (헤더 없음/잘못) | 401 + targetSelect 미호출 |
| 빈 대상 | `total: 0, succeeded: 0, failed: 0, results: []` |
| 모든 target 성공 (concurrency=1) | 순차 호출 + envelope 정상 |
| 모든 target 성공 (concurrency=3) | 병렬 호출 (call timing 검증) |
| target throw → status='error' | 다른 target 진행 막지 않음 |
| 에러 메시지 200자 절단 | 긴 throw 메시지가 정확히 200자 |
| `extra` 호출 | envelope.extra 에 반영 |
| `extra` 없음 | envelope.extra 키 자체 부재 |
| `targetSelect` throw | 500 propagate (catch 안 함) |
| `getId` 결과 → results[].id | id 매핑 검증 |
| `getLabel?` 미지정 시 | results[].label 부재 |

### 6.3 caller-side 잔존 테스트

각 cron route 의 *wiring* 만 검증 (mocked `createCronHandler`):
- `poll-gmail` — `targetSelect` 가 `oauthState='active'` 쿼리, `perTarget` 가 `syncInbox` 호출, `concurrency=5`, `extra` 가 reauth 카운트 반환.
- `morning-digest` — `perTarget` 이 0건이면 push 안 보냄, 만료 endpoint 삭제.
- `generate-daily-fortunes` — `targetSelect` 가 fortuneProfiles INNER JOIN, `concurrency=2` (회귀 가드), `extra.forDate` KST.

## 7. 회귀 위험

- **응답 envelope 키 이름 변경** — 외부 모니터링 도구가 옛 키를 읽고 있다면 깨짐. 추측건대 *없음* (node-cron 컨테이너가 stdout 으로만 받음). PR 작성 시 grep 으로 검증.
- **`generate-daily-fortunes` concurrency 무제한 → 2** — 매일 자정 처리 시간이 늘어남. 활성 프로필 N개 × LLM 호출 평균 시간. N=10, avg=15s → 옛: ~15s (병렬), 새: ~75s (concurrency 2). 자정 cron 이라 영향 미미.
- **에러 메시지 200자 절단** — `morning-digest` / `poll-gmail` 의 운영 로그가 짧아짐. Docker stderr 같은 긴 메시지는 truncate. 디버깅 시 stderr 직접 보면 됨.
- **`extra` 슬롯으로 키 이동** — `reauthRequired` (poll-gmail), `forDate` (generate-daily-fortunes) 가 top-level → `extra.*`. 같은 정보가 한 단계 깊어진 위치에 있음. 운영 grep 시 path 갱신 필요.

## 8. 구현 순서

1. **`createCronHandler.ts` + 단위 테스트** 작성. 자체 검증 (caller 없이도 cachedReading 처럼 typecheck OK).
2. **3 caller 리팩토링** — friction #1 과 달리 PR 분리 *불필요* (envelope 표준화의 가치가 한 번에 보임, 그리고 caller 가 한 줄). 한 PR 로 묶음.
3. **검증** — `pnpm typecheck` / `pnpm lint` / `pnpm test`. 옛 cron 테스트 (있다면) 폐기 + 신규 `createCronHandler.test.ts` 통과.
4. **PR 머지 → 컨테이너 교체** — DB 마이그레이션 없으므로 friction #1 의 (A) 흐름 *단순화*: PR 머지 → `Build & Push` 대기 → `compose pull && up -d app cron`.
5. **운영 검증** — 다음 자정 KST cron (`generate-daily-fortunes`) + 매시간 (`poll-gmail`) + 아침 8시 (`morning-digest`) 정상 실행. 새 envelope 모양 stdout 확인.

## 9. 미해결 사항

- **테스트 폐기/이동** — friction #1 에서 §7 전면 재구조화를 별도 PR 로 미뤘듯, cron 테스트도 같은 정책. *caller-side wiring 검증* 만 caller 측에 남기고 *시퀀스 검증* 은 `createCronHandler.test.ts` 로 이동.
- **두 번째 caller 후 port 승격** — 현재 `verifyCronBearer` 는 모듈 내부 직접 import. 두 번째 인증 방식 (예: HMAC) 이 필요해지면 `bearerCheck?` 옵션으로 inject. 현재는 YAGNI.
- **친구션 #3, #4** — 다음 세션에서 같은 패턴 (grilling → spec → 구현).
