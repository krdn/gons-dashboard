# Email 위젯 설정 기능 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email 위젯(답장 필요·중요 메일)에 ⚙ 설정 다이얼로그를 추가해 조회 기간·표시 개수·알림 임계값·카테고리 필터·LLM 분류 on/off·동기화 주기·다이제스트 시각을 사용자가 제어하고, "지금 동기화"/"재분류" 버튼으로 즉시 작동시킨다.

**Architecture:** 단일 진실 소스 `getEmailSettings(userId)`(DB row 없으면 `EMAIL_SETTINGS_DEFAULTS` 반환, 기본값=현재 하드코딩 값) → 위젯/cron/분류기가 모두 이를 통해 설정을 읽는다. 설정 저장은 `updateEmailSettings` Server Action + `revalidatePath("/")`로 즉시 위젯 재렌더. cron은 15분마다 깨어나 실행 시점에 due를 체크해 사용자 설정(동기화 주기·다이제스트 시각)을 반영한다.

**Tech Stack:** Next.js 16 App Router(RSC + Server Actions), TypeScript strict, Drizzle ORM + PostgreSQL 16, Zod, Radix Dialog(`@radix-ui/react-dialog`), Vitest, node-cron, web-push.

**참조 스펙:** `docs/superpowers/specs/2026-06-15-email-widget-settings-design.md`

---

## 파일 구조

**신규 생성:**
- `apps/dashboard/src/shared/lib/db/schema/email.ts` — `emailSettings` 테이블 추가(기존 파일 수정)
- `apps/dashboard/src/entities/email-settings/model/types.ts` — `EmailSettings` 타입 + `EMAIL_SETTINGS_DEFAULTS` + 순수 헬퍼(`meetsSeverity`, `meetsImportance`, `isSyncDue`, `isDigestDue`)
- `apps/dashboard/src/entities/email-settings/model/helpers.test.ts` — 순수 헬퍼 단위 테스트
- `apps/dashboard/src/entities/email-settings/api/getEmailSettings.ts` — server: row 없으면 DEFAULTS
- `apps/dashboard/src/entities/email-settings/index.ts` — server entrypoint(`import "server-only"`)
- `apps/dashboard/src/entities/email-settings/client.ts` — 타입 + DEFAULTS + 순수 헬퍼만(client 안전)
- `apps/dashboard/src/features/email-settings-manage/api/_schema.ts` — Zod `EmailSettingsInput` + `EmailSettingsActionResult`
- `apps/dashboard/src/features/email-settings-manage/api/_schema.test.ts` — Zod 경계값 테스트
- `apps/dashboard/src/features/email-settings-manage/api/updateEmailSettings.ts` — `"use server"`
- `apps/dashboard/src/features/email-settings-manage/api/syncNowAction.ts` — `"use server"` → syncInbox
- `apps/dashboard/src/features/email-settings-manage/api/reclassifyAction.ts` — `"use server"` → reclassifyRecent
- `apps/dashboard/src/features/email-settings-manage/ui/EmailSettingsDialog.tsx` — `"use client"` 다이얼로그 셸 + ⚙ 트리거
- `apps/dashboard/src/features/email-settings-manage/ui/EmailSettingsForm.tsx` — `"use client"` 폼 본체
- `apps/dashboard/src/features/email-settings-manage/client.ts` — UI re-export

**수정:**
- `apps/dashboard/src/entities/email/api/getReplyNeeded.ts` — 설정값 적용(limit/window/severity 필터)
- `apps/dashboard/src/entities/email/api/getImportantEmails.ts` — 설정값 적용(limit/window/importance/category 필터)
- `apps/dashboard/src/entities/email/api/classifyThread.ts` — `useLlm?: boolean` 옵션
- `apps/dashboard/src/entities/email/api/classifyImportant.ts` — `useLlm?: boolean` 옵션
- `apps/dashboard/src/features/gmail-sync/lib/classifyThreadsLoop.ts` — LLM on/off 옵션 전달
- `apps/dashboard/src/features/gmail-sync/api/syncInbox.ts` — 설정 읽어 분류 옵션 주입
- `apps/dashboard/src/widgets/email-digest/ui/EmailDigestCard.tsx` — ⚙ 버튼 + limit 인자 제거
- `apps/dashboard/src/widgets/important-emails/ui/ImportantEmailsCard.tsx` — ⚙ 버튼 + limit 인자 제거
- `apps/dashboard/src/app/api/cron/poll-gmail/route.ts` — sync due 체크
- `apps/dashboard/src/app/api/cron/morning-digest/route.ts` — digest due 체크 + lastDigestSentDate
- `apps/cron/scheduler.js` — `"0 * * * *"` → `"*/15 * * * *"`, `"0 8 * * *"` → `"*/15 * * * *"`

---

## Task 1: `emailSettings` 스키마 추가 + 마이그레이션

**Files:**
- Modify: `apps/dashboard/src/shared/lib/db/schema/email.ts`

- [ ] **Step 1: 스키마 import에 필요한 컬럼 타입 추가**

`apps/dashboard/src/shared/lib/db/schema/email.ts` 상단 import를 다음으로 교체:

```typescript
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  boolean,
  jsonb,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import type { Category } from "@/entities/email/model/types";
```

- [ ] **Step 2: `emailSettings` 테이블 정의 추가**

같은 파일 맨 끝(파일 마지막 `});` 다음 줄)에 추가:

```typescript
/* Email 위젯 사용자 설정 — entities/email-settings.
 * user당 1행(userId PK). row 없으면 코드의 EMAIL_SETTINGS_DEFAULTS 사용.
 * 모든 default는 현재 하드코딩 값과 동일 — 미설정 사용자 동작 불변. */
export const emailSettings = pgTable("email_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),

  // 조회 시점 설정 (저장 즉시 위젯 반영)
  replyNeededLimit: integer("reply_needed_limit").notNull().default(5),
  importantLimit: integer("important_limit").notNull().default(10),
  windowDays: integer("window_days").notNull().default(7),

  // 알림 임계값
  replySeverityThreshold: text("reply_severity_threshold")
    .notNull()
    .default("med"), // 'high' | 'med' | 'low'
  importantThreshold: text("important_threshold").notNull().default("med"), // 'high' | 'med'

  // important 카테고리 필터 (보여줄 카테고리)
  categories: jsonb("categories")
    .$type<Category[]>()
    .notNull()
    .default(["money", "security", "schedule", "notice"]),

  // LLM 분류 on/off
  llmReplyEnabled: boolean("llm_reply_enabled").notNull().default(true),
  llmImportantEnabled: boolean("llm_important_enabled").notNull().default(true),

  // 동기화 주기 / 다이제스트 (cron이 실행 시점에 읽음)
  syncIntervalMinutes: integer("sync_interval_minutes").notNull().default(60),
  digestEnabled: boolean("digest_enabled").notNull().default(true),
  digestHourKst: integer("digest_hour_kst").notNull().default(8), // 0-23
  lastDigestSentDate: date("last_digest_sent_date"), // 'YYYY-MM-DD' KST, due 멱등성

  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});
```

- [ ] **Step 3: 마이그레이션 생성**

Run: `cd apps/dashboard && pnpm db:generate`
Expected: `drizzle/` 아래 새 `.sql` 마이그레이션 파일 생성. 출력에 `CREATE TABLE "email_settings"` 포함. snapshot id 충돌 시(메모리 `drizzle-snapshot-id-collision`) 해당 entry의 `id`/`prevId` 두 줄만 수정.

- [ ] **Step 4: 타입 체크로 스키마 컴파일 확인**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS(emailSettings 타입 에러 없음). `Category` import 순환 의심 시 — `email.ts`가 `@/entities/email/model/types`를 import하는데 이는 schema를 import하지 않으므로 순환 없음.

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/shared/lib/db/schema/email.ts apps/dashboard/drizzle/
git commit -m "feat(email): email_settings 테이블 추가 — 위젯 사용자 설정 저장소"
```

---

## Task 2: `entities/email-settings` 타입 + 순수 헬퍼 (TDD)

**Files:**
- Create: `apps/dashboard/src/entities/email-settings/model/types.ts`
- Create: `apps/dashboard/src/entities/email-settings/model/helpers.test.ts`

- [ ] **Step 1: 타입 + DEFAULTS + 순수 헬퍼 작성**

`apps/dashboard/src/entities/email-settings/model/types.ts`:

```typescript
// Email 위젯 설정 — 타입 + 기본값 + 순수 헬퍼.
// client/server 양쪽에서 import 가능(순수 — DB·node 의존 없음).
import type { Category, Severity, ImportantImportance } from "@/entities/email/model/types";

export interface EmailSettings {
  replyNeededLimit: number;
  importantLimit: number;
  windowDays: number;
  replySeverityThreshold: Severity; // 이 이상만 표시/알림
  importantThreshold: ImportantImportance;
  categories: Category[];
  llmReplyEnabled: boolean;
  llmImportantEnabled: boolean;
  syncIntervalMinutes: number;
  digestEnabled: boolean;
  digestHourKst: number;
}

// 현재 하드코딩 값과 동일 — 미설정 사용자 동작 불변(spec 불변식).
export const EMAIL_SETTINGS_DEFAULTS: EmailSettings = {
  replyNeededLimit: 5,
  importantLimit: 10,
  windowDays: 7,
  replySeverityThreshold: "med",
  importantThreshold: "med",
  categories: ["money", "security", "schedule", "notice"],
  llmReplyEnabled: true,
  llmImportantEnabled: true,
  syncIntervalMinutes: 60,
  digestEnabled: true,
  digestHourKst: 8,
};

// severity 순위: high(0) < med(1) < low(2). 낮은 rank가 더 긴급.
const SEVERITY_RANK: Record<Severity, number> = { high: 0, med: 1, low: 2 };

// item severity가 threshold "이상"(같거나 더 긴급)인가.
export function meetsSeverity(item: Severity, threshold: Severity): boolean {
  return SEVERITY_RANK[item] <= SEVERITY_RANK[threshold];
}

const IMPORTANCE_RANK: Record<ImportantImportance, number> = { high: 0, med: 1 };

export function meetsImportance(
  item: ImportantImportance,
  threshold: ImportantImportance,
): boolean {
  return IMPORTANCE_RANK[item] <= IMPORTANCE_RANK[threshold];
}

// 동기화 due: lastSyncAt이 없거나, now - lastSyncAt >= interval.
export function isSyncDue(
  now: Date,
  lastSyncAt: Date | null,
  intervalMinutes: number,
): boolean {
  if (!lastSyncAt) return true;
  const elapsedMs = now.getTime() - lastSyncAt.getTime();
  return elapsedMs >= intervalMinutes * 60 * 1000;
}

// 다이제스트 due: 활성 + 현재 KST 시각(hour) >= digestHourKst + 오늘 미발송.
// nowKstHour: 0-23, todayKstDate/lastSentDate: 'YYYY-MM-DD'.
export function isDigestDue(params: {
  enabled: boolean;
  nowKstHour: number;
  digestHourKst: number;
  todayKstDate: string;
  lastSentDate: string | null;
}): boolean {
  const { enabled, nowKstHour, digestHourKst, todayKstDate, lastSentDate } =
    params;
  if (!enabled) return false;
  if (nowKstHour < digestHourKst) return false;
  return lastSentDate !== todayKstDate;
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`apps/dashboard/src/entities/email-settings/model/helpers.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  meetsSeverity,
  meetsImportance,
  isSyncDue,
  isDigestDue,
  EMAIL_SETTINGS_DEFAULTS,
} from "./types";

describe("meetsSeverity", () => {
  it("high item은 med threshold를 통과", () => {
    expect(meetsSeverity("high", "med")).toBe(true);
  });
  it("low item은 med threshold를 통과 못함", () => {
    expect(meetsSeverity("low", "med")).toBe(false);
  });
  it("med item은 med threshold를 통과(경계 포함)", () => {
    expect(meetsSeverity("med", "med")).toBe(true);
  });
  it("low threshold는 모두 통과", () => {
    expect(meetsSeverity("low", "low")).toBe(true);
    expect(meetsSeverity("high", "low")).toBe(true);
  });
});

describe("meetsImportance", () => {
  it("high는 med threshold 통과", () => {
    expect(meetsImportance("high", "med")).toBe(true);
  });
  it("med는 high threshold 통과 못함", () => {
    expect(meetsImportance("med", "high")).toBe(false);
  });
});

describe("isSyncDue", () => {
  const now = new Date("2026-06-15T10:00:00Z");
  it("lastSyncAt 없으면 due", () => {
    expect(isSyncDue(now, null, 60)).toBe(true);
  });
  it("interval 경과 시 due", () => {
    const last = new Date("2026-06-15T08:30:00Z"); // 90분 전
    expect(isSyncDue(now, last, 60)).toBe(true);
  });
  it("interval 미경과 시 not due", () => {
    const last = new Date("2026-06-15T09:30:00Z"); // 30분 전
    expect(isSyncDue(now, last, 60)).toBe(false);
  });
  it("정확히 interval일 때 due(경계)", () => {
    const last = new Date("2026-06-15T09:00:00Z"); // 정확히 60분 전
    expect(isSyncDue(now, last, 60)).toBe(true);
  });
});

describe("isDigestDue", () => {
  const base = {
    nowKstHour: 9,
    digestHourKst: 8,
    todayKstDate: "2026-06-15",
    lastSentDate: null,
  };
  it("활성 + 시각 도달 + 미발송이면 due", () => {
    expect(isDigestDue({ enabled: true, ...base })).toBe(true);
  });
  it("비활성이면 not due", () => {
    expect(isDigestDue({ enabled: false, ...base })).toBe(false);
  });
  it("시각 미도달이면 not due", () => {
    expect(isDigestDue({ enabled: true, ...base, nowKstHour: 7 })).toBe(false);
  });
  it("오늘 이미 발송했으면 not due", () => {
    expect(
      isDigestDue({ enabled: true, ...base, lastSentDate: "2026-06-15" }),
    ).toBe(false);
  });
  it("어제 발송했으면 due", () => {
    expect(
      isDigestDue({ enabled: true, ...base, lastSentDate: "2026-06-14" }),
    ).toBe(true);
  });
});

describe("EMAIL_SETTINGS_DEFAULTS", () => {
  it("현재 하드코딩 값과 동일", () => {
    expect(EMAIL_SETTINGS_DEFAULTS.replyNeededLimit).toBe(5);
    expect(EMAIL_SETTINGS_DEFAULTS.importantLimit).toBe(10);
    expect(EMAIL_SETTINGS_DEFAULTS.windowDays).toBe(7);
    expect(EMAIL_SETTINGS_DEFAULTS.categories).toEqual([
      "money",
      "security",
      "schedule",
      "notice",
    ]);
  });
});
```

- [ ] **Step 3: 테스트 실행해 통과 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test -- helpers.test`
Expected: PASS(순수 함수라 DB 불필요, 모든 테스트 통과). 구현이 테스트와 함께 작성됐으므로 GREEN.

- [ ] **Step 4: 커밋**

```bash
git add apps/dashboard/src/entities/email-settings/model/
git commit -m "feat(email-settings): 설정 타입·기본값·순수 헬퍼 + 단위 테스트"
```

---

## Task 3: `getEmailSettings` + 슬라이스 barrel (server/client seam)

**Files:**
- Create: `apps/dashboard/src/entities/email-settings/api/getEmailSettings.ts`
- Create: `apps/dashboard/src/entities/email-settings/index.ts`
- Create: `apps/dashboard/src/entities/email-settings/client.ts`

- [ ] **Step 1: `getEmailSettings` 작성**

`apps/dashboard/src/entities/email-settings/api/getEmailSettings.ts`:

```typescript
// 사용자 email 설정 조회 — row 없으면 EMAIL_SETTINGS_DEFAULTS.
// 위젯/cron/분류기의 단일 진실 소스(spec 불변식).
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { emailSettings } from "@/shared/lib/db/schema";
import type { Category, Severity, ImportantImportance } from "@/entities/email/model/types";
import {
  EMAIL_SETTINGS_DEFAULTS,
  type EmailSettings,
} from "../model/types";

export async function getEmailSettings(userId: string): Promise<EmailSettings> {
  const [row] = await db
    .select()
    .from(emailSettings)
    .where(eq(emailSettings.userId, userId))
    .limit(1);

  if (!row) return EMAIL_SETTINGS_DEFAULTS;

  return {
    replyNeededLimit: row.replyNeededLimit,
    importantLimit: row.importantLimit,
    windowDays: row.windowDays,
    replySeverityThreshold: row.replySeverityThreshold as Severity,
    importantThreshold: row.importantThreshold as ImportantImportance,
    categories: row.categories as Category[],
    llmReplyEnabled: row.llmReplyEnabled,
    llmImportantEnabled: row.llmImportantEnabled,
    syncIntervalMinutes: row.syncIntervalMinutes,
    digestEnabled: row.digestEnabled,
    digestHourKst: row.digestHourKst,
  };
}
```

- [ ] **Step 2: server entrypoint(`index.ts`) 작성**

`apps/dashboard/src/entities/email-settings/index.ts`:

```typescript
// server entrypoint — DB 의존(getEmailSettings) 포함.
import "server-only";
export { getEmailSettings } from "./api/getEmailSettings";
export {
  EMAIL_SETTINGS_DEFAULTS,
  meetsSeverity,
  meetsImportance,
  isSyncDue,
  isDigestDue,
  type EmailSettings,
} from "./model/types";
```

- [ ] **Step 3: client entrypoint(`client.ts`) 작성**

`apps/dashboard/src/entities/email-settings/client.ts`:

```typescript
// client 안전 entrypoint — 순수 타입·헬퍼만(DB 의존 없음).
export {
  EMAIL_SETTINGS_DEFAULTS,
  meetsSeverity,
  meetsImportance,
  type EmailSettings,
} from "./model/types";
```

- [ ] **Step 4: 타입 체크**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS. `db.select().from(emailSettings)`가 새 컬럼들을 인식.

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/entities/email-settings/
git commit -m "feat(email-settings): getEmailSettings + server/client seam barrel"
```

---

## Task 4: `getReplyNeeded` 설정 적용

**Files:**
- Modify: `apps/dashboard/src/entities/email/api/getReplyNeeded.ts`

- [ ] **Step 1: import에 설정·헬퍼 추가**

`getReplyNeeded.ts` 상단 import 블록(현재 12번째 줄 `import { replyNeeded, emailThreads } from "@/shared/lib/db/schema";` 다음)에 추가:

```typescript
import { getEmailSettings, meetsSeverity } from "@/entities/email-settings";
```

> 주의: `entities/email`이 `entities/email-settings`를 import한다. FSD에서 entities 간 직접 import는 원칙상 금지지만, 이 프로젝트의 ESLint boundaries 설정이 이를 허용하는지 Step 4에서 확인한다. 위반 시 대안은 Step 5 참조.

- [ ] **Step 2: 함수 시그니처와 본문을 설정 적용형으로 교체**

`getReplyNeeded` 함수 전체(현재 34~85줄)를 다음으로 교체:

```typescript
/**
 * 사용자의 reply_needed TOP N (severity DESC, classified_at DESC).
 * limit/window/severity 임계값은 email_settings에서 읽음.
 *
 * @param userId 사용자 UUID
 * @param limitOverride 명시 시 설정의 replyNeededLimit보다 우선(morning-digest는 5 고정).
 */
export async function getReplyNeeded(
  userId: string,
  limitOverride?: number,
): Promise<ReplyNeededItem[]> {
  const settings = await getEmailSettings(userId);
  const limit = limitOverride ?? settings.replyNeededLimit;

  const rows = await db
    .select({
      threadId: replyNeeded.threadId,
      gmailThreadId: emailThreads.gmailThreadId,
      fromName: emailThreads.lastSenderName,
      fromEmail: emailThreads.lastSenderEmail,
      subject: emailThreads.subject,
      snippet: emailThreads.snippet,
      receivedAt: emailThreads.lastReceivedAt,
      reason: replyNeeded.reason,
      severity: replyNeeded.severity,
      classifiedAt: replyNeeded.classifiedAt,
      classifiedBy: replyNeeded.classifiedBy,
    })
    .from(replyNeeded)
    .innerJoin(emailThreads, eq(replyNeeded.threadId, emailThreads.id))
    .where(
      and(
        eq(replyNeeded.userId, userId),
        isNull(replyNeeded.repliedAt),
        isNull(replyNeeded.dismissedAt),
        // 설정 윈도우(windowDays) — KST 기준.
        gte(
          replyNeeded.classifiedAt,
          sql`(NOW() AT TIME ZONE 'Asia/Seoul' - (${settings.windowDays} || ' days')::interval)::timestamp`,
        ),
      ),
    )
    .orderBy(
      sql`CASE ${replyNeeded.severity} WHEN 'high' THEN 0 WHEN 'med' THEN 1 ELSE 2 END`,
      desc(replyNeeded.classifiedAt),
    )
    .limit(limit);

  // severity 임계값 필터(앱 레이어 — 행 수가 적어 SQL 미세분기보다 명확).
  return rows
    .map((r) => ({
      ...r,
      severity: r.severity as ReplyNeededItem["severity"],
    }))
    .filter((r) => meetsSeverity(r.severity, settings.replySeverityThreshold));
}
```

> 변경점: ① `limit = 5` 기본값 제거 → `limitOverride?` + 설정값 fallback. ② 하드코딩 `INTERVAL '7 days'` → `settings.windowDays` 파라미터화. ③ severity 임계값 `.filter` 추가. ④ 사용 안 하던 `todayKstStart` 보조 변수(기존 40·78·79줄) 제거.

- [ ] **Step 3: 타입 체크**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: ESLint boundaries 확인(entities→entities)**

Run: `cd apps/dashboard && pnpm lint`
Expected: PASS이면 진행. `entities/email`→`entities/email-settings` import가 boundaries 위반으로 ERROR면 Step 5 적용.

- [ ] **Step 5: (boundaries 위반 시에만) 설정을 파라미터로 주입하는 형태로 전환**

위반이면 `getEmailSettings` 직접 import 대신 호출자(위젯/cron)가 설정을 읽어 인자로 넘긴다. `getReplyNeeded` 시그니처를 다음으로 변경:

```typescript
import type { Severity } from "../model/types";
import { meetsSeverity } from "@/entities/email-settings/client"; // client.ts는 순수라 경계 위반 아님(Step 4 lint로 재확인)

export async function getReplyNeeded(
  userId: string,
  opts?: { limit?: number; windowDays?: number; severityThreshold?: Severity },
): Promise<ReplyNeededItem[]> {
  const limit = opts?.limit ?? 5;
  const windowDays = opts?.windowDays ?? 7;
  const severityThreshold = opts?.severityThreshold ?? "low"; // low = 필터 없음
  // ... settings import 제거, 위 값들로 SQL(windowDays)·필터(severityThreshold) 구성
}
```

`client.ts` import도 경계 위반이면 헬퍼 `meetsSeverity`를 `entities/email/lib/severity-filter.ts`로 복제(순수 함수 6줄). **이 분기를 택했으면 이후 Task의 `getReplyNeeded(userId)` 호출(Task 11·13)을 모두 opts 전달형으로 조정**한다.

- [ ] **Step 6: 커밋**

```bash
git add apps/dashboard/src/entities/email/api/getReplyNeeded.ts
git commit -m "feat(email): getReplyNeeded 설정 적용 — limit/window/severity 임계값"
```

---

## Task 5: `getImportantEmails` 설정 적용

**Files:**
- Modify: `apps/dashboard/src/entities/email/api/getImportantEmails.ts`

> 전제: Task 4 Step 4에서 entities→entities import가 **허용**된 경우의 코드. 위반이라 Step 5 분기를 택했다면 동일하게 opts 주입형으로 작성한다.

- [ ] **Step 1: import 추가**

`getImportantEmails.ts`의 기존 import 줄(현재 10번째 `import { and, asc, desc, eq, gte, isNull } from "drizzle-orm";`)을 다음으로 교체(`sql`, `inArray` 추가):

```typescript
import { and, asc, desc, eq, gte, isNull, inArray } from "drizzle-orm";
```

그리고 17번째 줄 `import type { Category, ImportantImportance } from "../model/types";` 다음에 추가:

```typescript
import { getEmailSettings, meetsImportance } from "@/entities/email-settings";
```

- [ ] **Step 2: 함수 본문을 설정 적용형으로 교체**

`getImportantEmails` 함수 전체(현재 32~93줄)를 다음으로 교체:

```typescript
export async function getImportantEmails(
  userId: string,
  limitOverride?: number,
): Promise<ImportantEmailItem[]> {
  const settings = await getEmailSettings(userId);
  const limit = limitOverride ?? settings.importantLimit;
  const since = new Date(
    Date.now() - settings.windowDays * 24 * 60 * 60 * 1000,
  );

  const rows = await db
    .select({
      threadId: importantEmails.threadId,
      gmailThreadId: emailThreads.gmailThreadId,
      fromName: emailThreads.lastSenderName,
      fromEmail: emailThreads.lastSenderEmail,
      subject: emailThreads.subject,
      receivedAt: emailThreads.lastReceivedAt,
      category: importantEmails.category,
      importance: importantEmails.importance,
      summary: importantEmails.summary,
      classifiedAt: importantEmails.classifiedAt,
      activeReplyThreadId: replyNeeded.threadId,
    })
    .from(importantEmails)
    .innerJoin(emailThreads, eq(importantEmails.threadId, emailThreads.id))
    .leftJoin(
      replyNeeded,
      and(
        eq(replyNeeded.threadId, importantEmails.threadId),
        isNull(replyNeeded.repliedAt),
        isNull(replyNeeded.dismissedAt),
      ),
    )
    .where(
      and(
        eq(importantEmails.userId, userId),
        isNull(importantEmails.readAt),
        isNull(importantEmails.archivedAt),
        gte(importantEmails.classifiedAt, since),
        isNull(replyNeeded.threadId),
        // 카테고리 필터 — 빈 배열이면 결과 0(설정상 모두 끔).
        inArray(importantEmails.category, settings.categories),
      ),
    )
    .orderBy(asc(importantEmails.importance), desc(importantEmails.classifiedAt))
    .limit(limit);

  return rows
    .map((r) => ({
      threadId: r.threadId,
      gmailThreadId: r.gmailThreadId,
      fromName: r.fromName,
      fromEmail: r.fromEmail,
      subject: r.subject,
      receivedAt: r.receivedAt,
      category: r.category as Category,
      importance: r.importance as ImportantImportance,
      summary: r.summary,
      classifiedAt: r.classifiedAt,
    }))
    .filter((r) => meetsImportance(r.importance, settings.importantThreshold));
}
```

> 변경점: ① `limit = 10` 기본값 → `limitOverride?` + 설정. ② `7 * 24 * ...` → `settings.windowDays`. ③ `inArray(category, settings.categories)` 카테고리 필터. ④ importance 임계값 `.filter`.
> 주의: `inArray`에 **빈 배열**이 들어가면 Drizzle은 `false` 조건(결과 0행)을 생성한다 — 설정상 모든 카테고리를 끄면 위젯이 비는 것이 의도된 동작이다.

- [ ] **Step 3: 타입 체크 + 린트**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: 커밋**

```bash
git add apps/dashboard/src/entities/email/api/getImportantEmails.ts
git commit -m "feat(email): getImportantEmails 설정 적용 — limit/window/카테고리/importance"
```

---

## Task 6: 분류기 LLM on/off 옵션

**Files:**
- Modify: `apps/dashboard/src/entities/email/api/classifyThread.ts`
- Modify: `apps/dashboard/src/entities/email/api/classifyImportant.ts`

- [ ] **Step 1: `classifyThread.ts` 읽어 LLM 호출 지점 확인**

Run: `cd apps/dashboard && grep -n "ClassifyThreadParams\|classifyWithLLM\|llm-unavailable\|fallback" src/entities/email/api/classifyThread.ts`
Expected: `ClassifyThreadParams` 인터페이스 정의 줄, `classifyWithLLM(...)` 호출 줄, LLM 불가 시 deterministic fallback 분기 줄 번호 확인. 구현 시 이 fallback 분기를 재사용한다.

- [ ] **Step 2: `ClassifyThreadParams`에 `useLlm` 추가 + 분기**

`classifyThread.ts`의 `ClassifyThreadParams` 인터페이스에 필드 추가:

```typescript
export interface ClassifyThreadParams {
  userId: string;
  threadId: string;
  input: ThreadInput;
  /** false면 LLM 호출 생략, deterministic 결과만 사용(설정 llmReplyEnabled=false). 기본 true. */
  useLlm?: boolean;
}
```

함수 본문에서 deterministic 분류 통과 후 `classifyWithLLM`을 호출하는 지점을, `useLlm===false`일 때 LLM 네트워크 호출을 건너뛰고 기존 "LLM 불가 → deterministic fallback" 경로로 진입하도록 가드:

```typescript
const useLlm = params.useLlm ?? true;
// deterministic이 매치된 뒤, LLM 호출 전:
const llmResult = useLlm
  ? await classifyWithLLM(/* 기존 인자 */)
  : { kind: "llm-unavailable" as const };
// 이후 기존 코드가 llmResult.kind === "llm-unavailable"를 deterministic fallback으로 처리.
```

> Step 1에서 확인한 `classifyWithLLM`의 실제 인자와 반환 union을 그대로 사용한다. `llm-unavailable` kind가 기존에 존재하면 그 값을 재사용(새 kind·새 outcome 추가 금지). 만약 `classifyWithLLM`의 "불가" 표현이 다른 이름이면 그 이름으로 맞춘다. 목표: `useLlm===false`가 기존 LLM 실패 경로와 동일하게 동작.

- [ ] **Step 3: `classifyImportant.ts`에 `useLlm` 추가 + 분기**

`ClassifyImportantParams`에 필드 추가:

```typescript
export interface ClassifyImportantParams {
  userId: string;
  threadId: string;
  input: ImportantInput;
  signals: MailingListSignals;
  /** false면 important LLM 분류 생략(설정 llmImportantEnabled=false). 기본 true. */
  useLlm?: boolean;
}
```

`isMailingList` 컷 이후, `classifyImportantWithLlm` 호출 직전에 가드:

```typescript
const useLlm = params.useLlm ?? true;
if (!useLlm) {
  return { kind: "skipped-llm-error" }; // important는 LLM 전용, 끄면 기존 kind로 skip.
}
```

> important는 LLM 전용 분류라 끄면 `skipped-llm-error`(기존 kind 재사용)로 skip한다. 새 kind를 추가하지 않아 호출부 집계 코드(classifyThreadsLoop의 importantOutcomes) 변경이 불필요하다.

- [ ] **Step 4: 타입 체크**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS. `useLlm`이 optional이라 기존 호출부 무수정으로 컴파일됨.

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/entities/email/api/classifyThread.ts apps/dashboard/src/entities/email/api/classifyImportant.ts
git commit -m "feat(email): classifyThread/Important useLlm 옵션 — LLM 분류 on/off"
```

---

## Task 7: `classifyThreadsLoop` + `syncInbox` LLM 옵션 전달

**Files:**
- Modify: `apps/dashboard/src/features/gmail-sync/lib/classifyThreadsLoop.ts`
- Modify: `apps/dashboard/src/features/gmail-sync/api/syncInbox.ts`

- [ ] **Step 1: `ClassifyLoopParams`에 LLM 옵션 추가**

`classifyThreadsLoop.ts`의 `ClassifyLoopParams` 인터페이스(현재 28~35줄)에 추가:

```typescript
export interface ClassifyLoopParams {
  userId: string;
  ownerEmail: string;
  since: Date;
  signalsMap?: Map<string, MailingListSignals>;
  maxThreads?: number;
  /** LLM 분류 on/off(설정 반영). 미지정 시 둘 다 true. */
  llmReplyEnabled?: boolean;
  llmImportantEnabled?: boolean;
}
```

- [ ] **Step 2: 루프에서 `useLlm` 전달**

`classifyThreadsLoop` 본문 destructure(현재 46줄)를 다음으로 교체:

```typescript
const {
  userId,
  ownerEmail,
  since,
  signalsMap,
  maxThreads,
  llmReplyEnabled = true,
  llmImportantEnabled = true,
} = params;
```

`classifyThread({...})` 호출(현재 89~93줄)에 `useLlm: llmReplyEnabled` 추가:

```typescript
const outcome = await classifyThread({
  userId,
  threadId: t.id,
  input,
  useLlm: llmReplyEnabled,
});
```

`classifyImportantThread({...})` 호출(현재 102~113줄)에 `useLlm: llmImportantEnabled` 추가:

```typescript
const impOutcome = await classifyImportantThread({
  userId,
  threadId: t.id,
  input: {
    subject: t.subject ?? "",
    fromName: t.lastSenderName ?? null,
    fromEmail: (t.lastSenderEmail ?? "").toLowerCase(),
    snippet: t.snippet ?? "",
    receivedAtKst: formatKst(t.lastReceivedAt),
  },
  signals,
  useLlm: llmImportantEnabled,
});
```

- [ ] **Step 3: `syncInbox`에서 설정 읽어 전달**

`syncInbox.ts` import 블록(현재 29줄 `import { classifyThreadsLoop } from "../lib/classifyThreadsLoop";` 다음)에 추가:

```typescript
import { getEmailSettings } from "@/entities/email-settings";
```

`classifyAffectedThreads` 함수(현재 229~252줄)를 다음으로 교체:

```typescript
async function classifyAffectedThreads(
  userId: string,
  ownerEmail: string,
  signalsMap: Map<string, MailingListSignals> = new Map(),
): Promise<{ classified: number; skipped: number }> {
  const settings = await getEmailSettings(userId);
  // 24h 윈도우. 본인 1명·일~수백통 규모에서 충분.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await classifyThreadsLoop({
    userId,
    ownerEmail,
    since,
    signalsMap,
    llmReplyEnabled: settings.llmReplyEnabled,
    llmImportantEnabled: settings.llmImportantEnabled,
  });

  if (result.importantConsidered > 0) {
    logger.info("syncInbox", "important-outcomes", {
      userId,
      ownerEmail,
      importantOutcomes: result.importantOutcomes,
    });
  }

  return { classified: result.classified, skipped: result.skipped };
}
```

- [ ] **Step 4: 타입 체크**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/features/gmail-sync/lib/classifyThreadsLoop.ts apps/dashboard/src/features/gmail-sync/api/syncInbox.ts
git commit -m "feat(gmail-sync): 분류 루프에 LLM on/off 설정 전달"
```

---

## Task 8: Zod 스키마 + ActionResult (TDD)

**Files:**
- Create: `apps/dashboard/src/features/email-settings-manage/api/_schema.ts`
- Create: `apps/dashboard/src/features/email-settings-manage/api/_schema.test.ts`

- [ ] **Step 1: Zod 스키마 작성**

`apps/dashboard/src/features/email-settings-manage/api/_schema.ts`:

```typescript
import "server-only";
import { z } from "zod";

const CATEGORY_VALUES = ["money", "security", "schedule", "notice"] as const;

// 체크박스는 FormData에서 "on"/누락으로 옴 → boolean 변환 헬퍼.
const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.undefined(), z.null()])
  .transform((v) => v === "on" || v === "true");

const intIn = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max);

export const EmailSettingsInput = z.object({
  replyNeededLimit: intIn(1, 50),
  importantLimit: intIn(1, 50),
  windowDays: intIn(1, 90),
  replySeverityThreshold: z.enum(["high", "med", "low"]),
  importantThreshold: z.enum(["high", "med"]),
  // 카테고리: FormData에서 getAll("categories")로 string[] → 검증.
  categories: z.array(z.enum(CATEGORY_VALUES)),
  llmReplyEnabled: checkbox,
  llmImportantEnabled: checkbox,
  syncIntervalMinutes: z.coerce
    .number()
    .int()
    .refine((v) => [15, 30, 60, 180, 360].includes(v), {
      message: "동기화 주기는 15/30/60/180/360분 중 하나",
    }),
  digestEnabled: checkbox,
  digestHourKst: intIn(0, 23),
});

export type EmailSettingsInputT = z.infer<typeof EmailSettingsInput>;

export type EmailSettingsActionResult =
  | { ok: true }
  | {
      ok: false;
      code: "UNAUTHORIZED" | "INVALID_INPUT" | "DB_ERROR";
      message?: string;
    };
```

- [ ] **Step 2: 경계값 테스트 작성**

`apps/dashboard/src/features/email-settings-manage/api/_schema.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { EmailSettingsInput } from "./_schema";

const valid = {
  replyNeededLimit: "5",
  importantLimit: "10",
  windowDays: "7",
  replySeverityThreshold: "med",
  importantThreshold: "med",
  categories: ["money", "security"],
  llmReplyEnabled: "on",
  llmImportantEnabled: undefined,
  syncIntervalMinutes: "60",
  digestEnabled: "on",
  digestHourKst: "8",
};

describe("EmailSettingsInput", () => {
  it("유효 입력을 파싱하고 타입 변환", () => {
    const r = EmailSettingsInput.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.replyNeededLimit).toBe(5);
      expect(r.data.llmReplyEnabled).toBe(true);
      expect(r.data.llmImportantEnabled).toBe(false); // undefined → false
      expect(r.data.categories).toEqual(["money", "security"]);
    }
  });
  it("windowDays 0은 거부(min 1)", () => {
    expect(
      EmailSettingsInput.safeParse({ ...valid, windowDays: "0" }).success,
    ).toBe(false);
  });
  it("windowDays 91은 거부(max 90)", () => {
    expect(
      EmailSettingsInput.safeParse({ ...valid, windowDays: "91" }).success,
    ).toBe(false);
  });
  it("digestHourKst 24는 거부(max 23)", () => {
    expect(
      EmailSettingsInput.safeParse({ ...valid, digestHourKst: "24" }).success,
    ).toBe(false);
  });
  it("syncIntervalMinutes 45는 거부(허용 목록 외)", () => {
    expect(
      EmailSettingsInput.safeParse({ ...valid, syncIntervalMinutes: "45" })
        .success,
    ).toBe(false);
  });
  it("잘못된 카테고리 거부", () => {
    expect(
      EmailSettingsInput.safeParse({ ...valid, categories: ["bogus"] }).success,
    ).toBe(false);
  });
  it("빈 카테고리 배열 허용(모두 끔)", () => {
    expect(
      EmailSettingsInput.safeParse({ ...valid, categories: [] }).success,
    ).toBe(true);
  });
});
```

- [ ] **Step 3: 테스트 실행**

먼저 server-only 모듈이 vitest에서 어떻게 처리되는지 기존 패턴 확인:

Run: `cd apps/dashboard && grep -rn "server-only" vitest.config.* tests/setup.ts 2>/dev/null; cat src/features/tiger-profile-manage/api/tigerProfile.integration.test.ts | head -20`
Expected: `server-only`에 대한 alias/mock 설정 또는 integration test가 server-only를 어떻게 import하는지 확인.

그 다음 테스트 실행:

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test -- _schema.test`
Expected: PASS. server-only로 import 에러가 나면, vitest config에 `server-only` alias가 없을 때 한해 테스트 파일 상단에 `vi.mock("server-only", () => ({}));`를 추가하거나, 기존 integration test와 동일한 방식을 적용.

- [ ] **Step 4: 커밋**

```bash
git add apps/dashboard/src/features/email-settings-manage/api/_schema.ts apps/dashboard/src/features/email-settings-manage/api/_schema.test.ts
git commit -m "feat(email-settings): Zod 입력 스키마 + 경계값 테스트"
```

---

## Task 9: Server Actions (update / syncNow / reclassify)

**Files:**
- Create: `apps/dashboard/src/features/email-settings-manage/api/updateEmailSettings.ts`
- Create: `apps/dashboard/src/features/email-settings-manage/api/syncNowAction.ts`
- Create: `apps/dashboard/src/features/email-settings-manage/api/reclassifyAction.ts`

- [ ] **Step 1: `updateEmailSettings` 작성**

`apps/dashboard/src/features/email-settings-manage/api/updateEmailSettings.ts`:

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { emailSettings } from "@/shared/lib/db/schema";
import {
  EmailSettingsInput,
  type EmailSettingsActionResult,
} from "./_schema";

export async function updateEmailSettings(
  formData: FormData,
): Promise<EmailSettingsActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };

  // 체크박스/멀티값은 Object.fromEntries로 안 잡히므로 수동 구성.
  const raw = {
    replyNeededLimit: formData.get("replyNeededLimit"),
    importantLimit: formData.get("importantLimit"),
    windowDays: formData.get("windowDays"),
    replySeverityThreshold: formData.get("replySeverityThreshold"),
    importantThreshold: formData.get("importantThreshold"),
    categories: formData.getAll("categories"),
    llmReplyEnabled: formData.get("llmReplyEnabled"),
    llmImportantEnabled: formData.get("llmImportantEnabled"),
    syncIntervalMinutes: formData.get("syncIntervalMinutes"),
    digestEnabled: formData.get("digestEnabled"),
    digestHourKst: formData.get("digestHourKst"),
  };

  const parsed = EmailSettingsInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: parsed.error.issues.map((i) => i.message).join(", "),
    };
  }

  try {
    await db
      .insert(emailSettings)
      .values({ userId: session.user.id, ...parsed.data })
      .onConflictDoUpdate({
        target: emailSettings.userId,
        set: { ...parsed.data, updatedAt: new Date() },
      });
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: err instanceof Error ? err.message : "DB upsert failed",
    };
  }
}
```

> 주의: `parsed.data`에는 `lastDigestSentDate`가 없다(스키마에 없음). insert 시 그 컬럼은 NULL로 남고, digest cron이 채운다. upsert의 `set`이 `lastDigestSentDate`를 덮어쓰지 않으므로 cron이 기록한 발송 이력이 설정 저장으로 지워지지 않는다.

- [ ] **Step 2: `syncNowAction` 작성**

`apps/dashboard/src/features/email-settings-manage/api/syncNowAction.ts`:

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { syncInbox } from "@/features/gmail-sync";

export type SyncNowResult =
  | { ok: true; classified: number; skipped: number; reauth: boolean }
  | { ok: false; code: "UNAUTHORIZED" | "ERROR"; message?: string };

export async function syncNowAction(): Promise<SyncNowResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };

  try {
    const result = await syncInbox(session.user.id);
    revalidatePath("/");
    return {
      ok: true,
      classified: result.classifiedCount ?? 0,
      skipped: result.skippedCount ?? 0,
      reauth: result.kind === "reauth-required",
    };
  } catch (err) {
    return {
      ok: false,
      code: "ERROR",
      message: err instanceof Error ? err.message : "sync failed",
    };
  }
}
```

- [ ] **Step 3: `reclassifyAction` 작성**

`apps/dashboard/src/features/email-settings-manage/api/reclassifyAction.ts`:

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { reclassifyRecent } from "@/features/gmail-sync";

export type ReclassifyActionResult =
  | { ok: true; classified: number; skipped: number; threadsInWindow: number }
  | { ok: false; code: "UNAUTHORIZED" | "ERROR"; message?: string };

export async function reclassifyAction(): Promise<ReclassifyActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };

  try {
    // 최근 24h 윈도우 재분류, force=false(기존 important 보존하며 갱신).
    const result = await reclassifyRecent({
      userId: session.user.id,
      hoursBack: 24,
      force: false,
    });
    if (result.kind === "user-not-found") {
      return { ok: false, code: "ERROR", message: "user not found" };
    }
    revalidatePath("/");
    return {
      ok: true,
      classified: result.classified ?? 0,
      skipped: result.skipped ?? 0,
      threadsInWindow: result.threadsInWindow ?? 0,
    };
  } catch (err) {
    return {
      ok: false,
      code: "ERROR",
      message: err instanceof Error ? err.message : "reclassify failed",
    };
  }
}
```

- [ ] **Step 4: 타입 체크**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS. `reclassifyRecent`/`syncInbox` 반환 타입이 `@/features/gmail-sync` barrel에서 export됨(확인됨).

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/features/email-settings-manage/api/updateEmailSettings.ts apps/dashboard/src/features/email-settings-manage/api/syncNowAction.ts apps/dashboard/src/features/email-settings-manage/api/reclassifyAction.ts
git commit -m "feat(email-settings): update/syncNow/reclassify Server Actions"
```

---

## Task 10: 설정 폼 + 다이얼로그 UI

**Files:**
- Create: `apps/dashboard/src/features/email-settings-manage/ui/EmailSettingsForm.tsx`
- Create: `apps/dashboard/src/features/email-settings-manage/ui/EmailSettingsDialog.tsx`
- Create: `apps/dashboard/src/features/email-settings-manage/client.ts`

- [ ] **Step 1: 폼 컴포넌트 작성**

`apps/dashboard/src/features/email-settings-manage/ui/EmailSettingsForm.tsx`:

```typescript
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  EMAIL_SETTINGS_DEFAULTS,
  type EmailSettings,
} from "@/entities/email-settings/client";
import { updateEmailSettings } from "../api/updateEmailSettings";
import { syncNowAction } from "../api/syncNowAction";
import { reclassifyAction } from "../api/reclassifyAction";

const CATEGORY_LABEL: Record<string, string> = {
  money: "금전",
  security: "보안",
  schedule: "일정",
  notice: "공지",
};
const SYNC_OPTIONS = [
  { value: 15, label: "15분" },
  { value: 30, label: "30분" },
  { value: 60, label: "1시간" },
  { value: 180, label: "3시간" },
  { value: 360, label: "6시간" },
];

const labelCls = "text-xs font-medium text-[var(--color-text-muted)]";
const inputCls =
  "mt-1 w-full rounded border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]";
const sectionCls =
  "border-t border-[var(--color-hairline)] pt-3 first:border-t-0 first:pt-0";

interface Props {
  initial?: EmailSettings;
  onDone: () => void;
}

export function EmailSettingsForm({ initial, onDone }: Props) {
  const s = initial ?? EMAIL_SETTINGS_DEFAULTS;
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [actionPending, startActionTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(() => {
      updateEmailSettings(formData).then((result) => {
        if (!result.ok) {
          setError(result.message ?? result.code);
          return;
        }
        router.refresh();
        onDone();
      });
    });
  }

  function onSyncNow() {
    setActionMsg("동기화 중…");
    startActionTransition(() => {
      syncNowAction().then((r) => {
        if (!r.ok) {
          setActionMsg(r.message ?? "동기화 실패");
          return;
        }
        if (r.reauth) {
          setActionMsg("재로그인이 필요합니다");
          return;
        }
        setActionMsg(`동기화 완료 — ${r.classified}건 분류`);
        router.refresh();
      });
    });
  }

  function onReclassify() {
    setActionMsg("재분류 중…");
    startActionTransition(() => {
      reclassifyAction().then((r) => {
        if (!r.ok) {
          setActionMsg(r.message ?? "재분류 실패");
          return;
        }
        setActionMsg(`재분류 완료 — ${r.classified}건 분류`);
        router.refresh();
      });
    });
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      {/* 표시 */}
      <div className={sectionCls}>
        <p className="mb-2 text-sm font-semibold text-[var(--color-text)]">표시</p>
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className={labelCls}>조회 기간(일)</span>
            <input type="number" name="windowDays" min={1} max={90} defaultValue={s.windowDays} className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>답장 필요 개수</span>
            <input type="number" name="replyNeededLimit" min={1} max={50} defaultValue={s.replyNeededLimit} className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>중요 메일 개수</span>
            <input type="number" name="importantLimit" min={1} max={50} defaultValue={s.importantLimit} className={inputCls} />
          </label>
        </div>
      </div>

      {/* 알림 */}
      <div className={sectionCls}>
        <p className="mb-2 text-sm font-semibold text-[var(--color-text)]">알림</p>
        <label className="mb-2 flex items-center gap-2 text-sm">
          <input type="checkbox" name="digestEnabled" defaultChecked={s.digestEnabled} value="on" />
          아침 다이제스트 켜기
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={labelCls}>발송 시각(KST, 0-23)</span>
            <input type="number" name="digestHourKst" min={0} max={23} defaultValue={s.digestHourKst} className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>답장 알림 민감도</span>
            <select name="replySeverityThreshold" defaultValue={s.replySeverityThreshold} className={inputCls}>
              <option value="high">높음만</option>
              <option value="med">보통 이상</option>
              <option value="low">전체</option>
            </select>
          </label>
        </div>
      </div>

      {/* 중요 필터 */}
      <div className={sectionCls}>
        <p className="mb-2 text-sm font-semibold text-[var(--color-text)]">중요 메일 필터</p>
        <div className="mb-2 flex flex-wrap gap-3 text-sm">
          {(["money", "security", "schedule", "notice"] as const).map((c) => (
            <label key={c} className="flex items-center gap-1.5">
              <input type="checkbox" name="categories" value={c} defaultChecked={s.categories.includes(c)} />
              {CATEGORY_LABEL[c]}
            </label>
          ))}
        </div>
        <label className="block">
          <span className={labelCls}>중요도</span>
          <select name="importantThreshold" defaultValue={s.importantThreshold} className={inputCls}>
            <option value="med">보통 이상</option>
            <option value="high">높음만</option>
          </select>
        </label>
      </div>

      {/* 분류 엔진 */}
      <div className={sectionCls}>
        <p className="mb-2 text-sm font-semibold text-[var(--color-text)]">분류 엔진</p>
        <label className="mb-1.5 flex items-center gap-2 text-sm">
          <input type="checkbox" name="llmReplyEnabled" defaultChecked={s.llmReplyEnabled} value="on" />
          답장 LLM 분류
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="llmImportantEnabled" defaultChecked={s.llmImportantEnabled} value="on" />
          중요 메일 LLM 분류
        </label>
      </div>

      {/* 동기화 */}
      <div className={sectionCls}>
        <p className="mb-2 text-sm font-semibold text-[var(--color-text)]">동기화</p>
        <label className="block">
          <span className={labelCls}>동기화 주기</span>
          <select name="syncIntervalMinutes" defaultValue={s.syncIntervalMinutes} className={inputCls}>
            {SYNC_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={onSyncNow} disabled={actionPending} className="rounded border border-[var(--color-hairline)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-2)] disabled:opacity-50">
            지금 동기화
          </button>
          <button type="button" onClick={onReclassify} disabled={actionPending} className="rounded border border-[var(--color-hairline)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-2)] disabled:opacity-50">
            재분류
          </button>
          {actionMsg && <span className="text-xs text-[var(--color-text-muted)]">{actionMsg}</span>}
        </div>
      </div>

      {error && <p role="alert" className="text-xs text-red-600">저장 실패: {error}</p>}

      <div className="mt-1 flex items-center justify-end gap-2">
        <button type="button" onClick={onDone} className="rounded border border-[var(--color-hairline)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]">
          취소
        </button>
        <button type="submit" disabled={pending} className="rounded bg-[var(--color-accent)] px-4 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
          {pending ? "저장 중…" : "저장"}
        </button>
      </div>
    </form>
  );
}
```

> 에러 표시는 `react-error-boundaries` lint 규칙 준수 — Server Action 결과를 `.then(result => {...})`로 받아 분기(try/catch 안 JSX 금지). 토스트 라이브러리가 없으므로 인라인 상태 텍스트 사용(`actionMsg`, `error`).

- [ ] **Step 2: 다이얼로그 셸 + ⚙ 트리거 작성**

`apps/dashboard/src/features/email-settings-manage/ui/EmailSettingsDialog.tsx`:

```typescript
"use client";

import { useState } from "react";
import { Modal } from "@/shared/ui/Modal";
import type { EmailSettings } from "@/entities/email-settings/client";
import { EmailSettingsForm } from "./EmailSettingsForm";

interface Props {
  initial?: EmailSettings;
}

export function EmailSettingsDialog({ initial }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="이메일 설정"
        onClick={() => setOpen(true)}
        className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
      >
        {/* gear 아이콘(인라인 SVG — shared/ui/icons.tsx에 gear 없으면 인라인 유지) */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <Modal open={open} onOpenChange={setOpen} title="이메일 설정" size="sm">
        <EmailSettingsForm initial={initial} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}
```

- [ ] **Step 3: client.ts seam 작성**

`apps/dashboard/src/features/email-settings-manage/client.ts`:

```typescript
// client entrypoint — "use client" 컴포넌트는 여기서만 import.
// Server Action(updateEmailSettings 등)은 컴포넌트 내부에서 직접 import하므로
// 여기서는 UI 컴포넌트만 re-export.
export { EmailSettingsDialog } from "./ui/EmailSettingsDialog";
export { EmailSettingsForm } from "./ui/EmailSettingsForm";
```

- [ ] **Step 4: 타입 체크 + 린트**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: PASS. `Modal` import 경로(`@/shared/ui/Modal`)와 `EmailSettings` 타입(`@/entities/email-settings/client`) 확인. `var(--color-surface-2)` 등 토큰이 globals.css에 없으면 lint는 통과하나 시각만 다름 — 존재 여부는 Step 5 빌드 후 브라우저 확인 권장(필수 아님).

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/features/email-settings-manage/ui/ apps/dashboard/src/features/email-settings-manage/client.ts
git commit -m "feat(email-settings): 설정 폼 + 다이얼로그 + ⚙ 트리거 UI"
```

---

## Task 11: 위젯 헤더에 ⚙ 버튼 배치

**Files:**
- Modify: `apps/dashboard/src/widgets/email-digest/ui/EmailDigestCard.tsx`
- Modify: `apps/dashboard/src/widgets/important-emails/ui/ImportantEmailsCard.tsx`

- [ ] **Step 1: `EmailDigestCard`에 설정 로드 + ⚙ 배치**

`EmailDigestCard.tsx` 전체를 다음으로 교체:

```typescript
// 메인 위젯 — RSC. 사용자의 reply_needed 표시(개수는 설정값).
import { auth } from "@/shared/lib/auth";
import { getReplyNeeded } from "@/entities/email";
import { getEmailSettings } from "@/entities/email-settings";
import { EmailSettingsDialog } from "@/features/email-settings-manage/client";
import { ReplyCard } from "./ReplyCard";
import { EmailDigestEmpty } from "./EmailDigestEmpty";

export async function EmailDigestCard() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const [items, settings] = await Promise.all([
    getReplyNeeded(session.user.id),
    getEmailSettings(session.user.id),
  ]);

  return (
    <section
      aria-labelledby="reply-needed-heading"
      className="col-span-1 max-w-[760px]"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2
          id="reply-needed-heading"
          className="flex items-baseline gap-2 text-base font-semibold tracking-tight text-[var(--color-text)]"
        >
          <span>오늘 답장 필요</span>
          <span className="font-mono text-xs font-medium tabular-nums text-[var(--color-text-muted)]">
            {items.length}
          </span>
        </h2>
        <EmailSettingsDialog initial={settings} />
      </div>

      {items.length === 0 ? (
        <EmailDigestEmpty />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <ReplyCard key={item.threadId} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
```

> 변경점: ① `getReplyNeeded(id, 5)` → `getReplyNeeded(id)`(설정의 replyNeededLimit 적용). ② `getEmailSettings` 병렬 로드해 다이얼로그 초기값 전달. ③ h2를 flex 헤더로 감싸 ⚙ 우측 배치.
> Task 4에서 opts 주입형(Step 5 분기)을 택했다면 `settings`를 먼저 await한 뒤 `getReplyNeeded(session.user.id, { limit: settings.replyNeededLimit, windowDays: settings.windowDays, severityThreshold: settings.replySeverityThreshold })`로 호출(이 경우 Promise.all 대신 순차 또는 settings를 별도 await).

- [ ] **Step 2: `ImportantEmailsCard`에 설정 로드 + ⚙ 배치**

`ImportantEmailsCard.tsx` 전체를 다음으로 교체:

```typescript
// 중요 메일 위젯 — RSC. important_emails 표시(개수·필터는 설정값).
import { auth } from "@/shared/lib/auth";
import { getImportantEmails } from "@/entities/email";
import { getEmailSettings } from "@/entities/email-settings";
import { EmailSettingsDialog } from "@/features/email-settings-manage/client";
import { ImportantEmailRow } from "./ImportantEmailRow";
import { ImportantEmailsEmpty } from "./ImportantEmailsEmpty";

export async function ImportantEmailsCard() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const [items, settings] = await Promise.all([
    getImportantEmails(session.user.id),
    getEmailSettings(session.user.id),
  ]);

  return (
    <section
      aria-labelledby="important-emails-heading"
      className="col-span-1 max-w-[760px]"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2
          id="important-emails-heading"
          className="flex items-baseline gap-2 text-base font-semibold tracking-tight text-[var(--color-text)]"
        >
          <span>최근 중요 메일</span>
          <span className="font-mono text-xs font-medium tabular-nums text-[var(--color-text-muted)]">
            {items.length}
          </span>
        </h2>
        <EmailSettingsDialog initial={settings} />
      </div>

      {items.length === 0 ? (
        <ImportantEmailsEmpty />
      ) : (
        <div role="list" className="flex flex-col gap-3">
          {items.map((item) => (
            <ImportantEmailRow key={item.threadId} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
```

> Task 5에서 opts 주입형을 택했다면 `getImportantEmails`도 동일하게 opts로 호출.

- [ ] **Step 3: 타입 체크 + 린트**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: PASS. widgets→features/client, widgets→entities import 방향이 FSD 허용 범위(widgets는 features·entities 양쪽 import 가능).

- [ ] **Step 4: 커밋**

```bash
git add apps/dashboard/src/widgets/email-digest/ui/EmailDigestCard.tsx apps/dashboard/src/widgets/important-emails/ui/ImportantEmailsCard.tsx
git commit -m "feat(email): 위젯 헤더에 ⚙ 설정 다이얼로그 배치 + 설정값 조회"
```

---

## Task 12: cron due 체크 — poll-gmail

**Files:**
- Modify: `apps/dashboard/src/app/api/cron/poll-gmail/route.ts`

- [ ] **Step 1: poll-gmail 라우트를 due 체크형으로 교체**

`poll-gmail/route.ts` 전체를 다음으로 교체:

```typescript
// Cron 15분마다 트리거 — 설정 동기화 주기에 따라 due인 사용자만 sync.
//
// 셰이프: createCronHandler factory. perTarget에서 isSyncDue로 due 판정.
// 설정 syncIntervalMinutes(기본 60) 미경과 사용자는 skipped-not-due.
import { ne, eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { users } from "@/shared/lib/db/schema";
import { createCronHandler } from "@/shared/lib/cron/createCronHandler";
import { syncInbox } from "@/features/gmail-sync";
import { getEmailSettings, isSyncDue } from "@/entities/email-settings";

export const dynamic = "force-dynamic";

interface PollPayload {
  kind: string;
  classifiedCount?: number;
  skippedCount?: number;
}

export const POST = createCronHandler({
  name: "poll-gmail",
  targetSelect: async () =>
    db
      .select({
        id: users.id,
        email: users.email,
        lastSyncAt: users.lastSyncAt,
      })
      .from(users)
      .where(eq(users.oauthState, "active")),
  getId: (u) => u.id,
  getLabel: (u) => u.email,
  perTarget: async (u): Promise<PollPayload> => {
    const settings = await getEmailSettings(u.id);
    if (!isSyncDue(new Date(), u.lastSyncAt, settings.syncIntervalMinutes)) {
      return { kind: "skipped-not-due" };
    }
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
      .select({ id: users.id })
      .from(users)
      .where(ne(users.oauthState, "active"))
      .then((r) => r.length);
    return { reauthRequired: reauth };
  },
});
```

> `syncInbox`는 내부 `persistHistoryId`에서 `lastSyncAt`을 갱신한다. due가 아닌 사용자는 sync를 건너뛰어 `lastSyncAt`이 유지되고 다음 사이클에 다시 평가된다. `perTarget` 반환을 `PollPayload`로 명시해 union 추론 문제를 회피한다.

- [ ] **Step 2: 타입 체크**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: 커밋**

```bash
git add apps/dashboard/src/app/api/cron/poll-gmail/route.ts
git commit -m "feat(cron): poll-gmail 동기화 주기 due 체크 — 설정 syncIntervalMinutes 반영"
```

---

## Task 13: cron due 체크 — morning-digest

**Files:**
- Modify: `apps/dashboard/src/app/api/cron/morning-digest/route.ts`

- [ ] **Step 1: morning-digest 라우트를 due 체크형으로 교체**

`morning-digest/route.ts` 전체를 다음으로 교체:

```typescript
// 15분마다 트리거 — 설정 digestHourKst 도달 + 오늘 미발송 사용자만 발송.
//
// isDigestDue로 판정 후, 발송 성공 시 email_settings.lastDigestSentDate=오늘(KST).
// 멱등: 같은 날 재실행은 lastDigestSentDate 비교로 skip.
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { users, pushSubscriptions, emailSettings } from "@/shared/lib/db/schema";
import { createCronHandler } from "@/shared/lib/cron/createCronHandler";
import { getReplyNeeded } from "@/entities/email";
import { getEmailSettings, isDigestDue } from "@/entities/email-settings";
import { sendPush } from "@/shared/lib/push";

export const dynamic = "force-dynamic";

interface DigestPayload {
  kind: string;
  itemCount?: number;
  sent?: number;
  expired?: number;
  errors?: number;
}

// 현재 KST 시각(hour 0-23)과 날짜('YYYY-MM-DD').
function nowKst(): { hour: number; date: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  // en-CA → YYYY-MM-DD; hour는 0-23(24는 자정 0으로 보정).
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const hourRaw = get("hour");
  const hour = hourRaw === "24" ? 0 : Number(hourRaw);
  return { hour, date };
}

export const POST = createCronHandler({
  name: "morning-digest",
  targetSelect: async () =>
    db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.oauthState, "active")),
  getId: (u) => u.id,
  getLabel: (u) => u.email,
  perTarget: async (u): Promise<DigestPayload> => {
    const settings = await getEmailSettings(u.id);
    const { hour, date } = nowKst();

    // 오늘 발송 여부 — email_settings.lastDigestSentDate 조회.
    const [row] = await db
      .select({ lastDigestSentDate: emailSettings.lastDigestSentDate })
      .from(emailSettings)
      .where(eq(emailSettings.userId, u.id))
      .limit(1);
    const lastSentDate = row?.lastDigestSentDate ?? null;

    if (
      !isDigestDue({
        enabled: settings.digestEnabled,
        nowKstHour: hour,
        digestHourKst: settings.digestHourKst,
        todayKstDate: date,
        lastSentDate,
      })
    ) {
      return { kind: "skipped-not-due" };
    }

    const items = await getReplyNeeded(u.id, 5); // 다이제스트는 5건 고정.
    if (items.length === 0) {
      // 빈 디지스트도 "오늘 처리함"으로 기록 — 같은 날 반복 평가 방지.
      await markDigestSent(u.id, date);
      return { kind: "ok", itemCount: 0, sent: 0, expired: 0, errors: 0 };
    }

    const subs = await db
      .select({
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, u.id));

    const title = `오늘 답장 필요 ${items.length}건`;
    const top = items[0];
    const body =
      items.length === 1
        ? `${top.fromName ?? top.fromEmail} — ${top.subject ?? "(제목 없음)"}`
        : `${top.fromName ?? top.fromEmail} 외 ${items.length - 1}건`;

    let sent = 0;
    let expired = 0;
    let errors = 0;
    const expiredEndpoints: string[] = [];

    for (const sub of subs) {
      const result = await sendPush(sub, {
        title,
        body,
        url: "/",
        tag: "morning-digest",
      });
      if (result.kind === "sent") sent += 1;
      else if (result.kind === "expired") {
        expired += 1;
        expiredEndpoints.push(result.endpoint);
      } else if (result.kind === "error") errors += 1;
    }

    if (expiredEndpoints.length > 0) {
      for (const endpoint of expiredEndpoints) {
        await db
          .delete(pushSubscriptions)
          .where(eq(pushSubscriptions.endpoint, endpoint));
      }
    }

    await markDigestSent(u.id, date);
    return { kind: "ok", itemCount: items.length, sent, expired, errors };
  },
  concurrency: 10,
});

// 발송 기록 — email_settings row 없으면 생성(default + lastDigestSentDate).
async function markDigestSent(userId: string, dateKst: string): Promise<void> {
  await db
    .insert(emailSettings)
    .values({ userId, lastDigestSentDate: dateKst })
    .onConflictDoUpdate({
      target: emailSettings.userId,
      set: { lastDigestSentDate: dateKst, updatedAt: new Date() },
    });
}
```

> `lastDigestSentDate`는 `date` 컬럼이라 Drizzle에서 `'YYYY-MM-DD'` 문자열로 주고받는다(mode 미지정 시 string). `nowKst()`의 `en-CA` 로케일이 `YYYY-MM-DD`를 보장. `getReplyNeeded(u.id, 5)`는 limitOverride=5라 설정의 replyNeededLimit를 무시하고 항상 5건 요약(spec §4-A 호환성 규칙).

- [ ] **Step 2: 타입 체크**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS. `emailSettings.lastDigestSentDate`가 `string | null`로 추론되는지 확인(date 컬럼 mode 미지정 → string). `Date`로 추론되면 `nowKst().date`를 `new Date(date)`로 감싸거나 schema에서 `date(..., { mode: "string" })` 명시.

- [ ] **Step 3: 커밋**

```bash
git add apps/dashboard/src/app/api/cron/morning-digest/route.ts
git commit -m "feat(cron): morning-digest 시각 due 체크 + lastDigestSentDate 멱등"
```

---

## Task 14: scheduler.js 15분 주기 전환

**Files:**
- Modify: `apps/cron/scheduler.js`

- [ ] **Step 1: poll-gmail 스케줄을 15분으로 변경**

`scheduler.js`에서 다음 블록(매시간 정각):

```javascript
// 매시간 정각 — Gmail polling.
cron.schedule(
  "0 * * * *",
  () => {
    void callCron("/api/cron/poll-gmail", "poll-gmail");
  },
  { timezone: TIMEZONE },
);
```

을 다음으로 교체:

```javascript
// 15분마다 — Gmail polling. 사용자별 동기화 주기는 app 레이어가 isSyncDue로 판정.
cron.schedule(
  "*/15 * * * *",
  () => {
    void callCron("/api/cron/poll-gmail", "poll-gmail");
  },
  { timezone: TIMEZONE },
);
```

- [ ] **Step 2: morning-digest 스케줄을 15분으로 변경**

다음 블록(매일 08:00):

```javascript
// 매일 08:00 KST — Morning digest 알림.
cron.schedule(
  "0 8 * * *",
  () => {
    void callCron("/api/cron/morning-digest", "morning-digest");
  },
  { timezone: TIMEZONE },
);
```

을 다음으로 교체:

```javascript
// 15분마다 — Morning digest. 사용자별 발송 시각은 app 레이어가 isDigestDue로 판정.
cron.schedule(
  "*/15 * * * *",
  () => {
    void callCron("/api/cron/morning-digest", "morning-digest");
  },
  { timezone: TIMEZONE },
);
```

- [ ] **Step 3: 시작 로그 문자열 갱신**

다음 줄:

```javascript
console.log(
  "[cron] 스케줄 등록 완료. polling=0 * * * *, digest=0 8 * * * KST, daily-fortunes=1 0 * * * KST, daily-tri=5 0 * * * KST, stock-kr=30 16 * * * KST, stock-us=30 6 * * * KST, krx-master=0 6 * * 0 KST",
);
```

를 다음으로 교체:

```javascript
console.log(
  "[cron] 스케줄 등록 완료. polling=*/15 * * * *, digest=*/15 * * * * KST(app-side due), daily-fortunes=1 0 * * * KST, daily-tri=5 0 * * * KST, stock-kr=30 16 * * * KST, stock-us=30 6 * * * KST, krx-master=0 6 * * 0 KST",
);
```

- [ ] **Step 4: 구문 검증**

Run: `cd apps/cron && node --check scheduler.js`
Expected: 출력 없음(구문 OK). 에러 시 교체 블록 재확인.

- [ ] **Step 5: 커밋**

```bash
git add apps/cron/scheduler.js
git commit -m "feat(cron): poll-gmail·digest 15분 주기로 전환 — 사용자 설정 due는 app이 판정"
```

> **운영 배포 주의:** 이 변경은 cron 컨테이너 재빌드·재배포가 필요하다(`ghcr.io/krdn/gons-dashboard-cron:latest`). PR 머지 후 GHA Build & Push → `docker --context home-server compose pull cron && up -d cron`. dashboard 이미지만 배포하면 cron은 옛 `0 * * * *`로 계속 돈다 — 단, 정확성 문제는 아니다: 매시간만 깨어나도 app-side due 체크는 동작하며, 설정 주기를 15·30분으로 줄여도 실제론 시간 단위로만 반영될 뿐이다.

---

## Task 15: 전체 검증 게이트 (build seam 포함)

**Files:** 없음(검증 전용)

- [ ] **Step 1: 타입 체크**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS.

- [ ] **Step 2: 린트(FSD boundaries 포함)**

Run: `cd apps/dashboard && pnpm lint`
Expected: PASS. entities→entities import 위반이 여기서 잡히면 Task 4 Step 5 분기로 되돌아가 전체 호출부(Task 5·11·13) 조정.

- [ ] **Step 3: 단위 테스트**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test -- helpers.test _schema.test`
Expected: PASS(순수 단위 테스트 통과). DB 통합 테스트는 ECONNREFUSED 허용(Gotcha #2).

- [ ] **Step 4: 프로덕션 빌드 — client/server seam 검증(필수)**

Run: `cd apps/dashboard && pnpm build`
Expected: PASS. `Module not found: Can't resolve 'tls'/'perf_hooks'/'net'` 에러가 나면(Gotcha #7) — `EmailSettingsDialog`/`EmailSettingsForm`이 server-only 모듈을 끌어온 것. 점검: 폼은 `@/entities/email-settings/client`(순수)만 import해야 하고, Server Action은 `../api/*`에서 직접 import(각각 `"use server"`)해야 한다. `@/entities/email-settings`(server barrel)를 client 컴포넌트가 import하면 실패.

- [ ] **Step 5: 변경 확인(빌드 산출물 제외)**

Run: `git status`
Expected: 추적 대상 코드는 모두 커밋됨. `.next/` 빌드 캐시는 커밋하지 않음(`.gitignore`에 이미 있음).

---

## Self-Review 결과(작성자 점검 — 구현 전 참고)

- **Spec 커버리지:** 시간 설정 3종(다이제스트 시각=Task 13/10, 동기화 주기=Task 12/14/10, 조회 윈도우=Task 4/5/10) ✓. 바로 작동(sync now=Task 9/10, reclassify=Task 9/10) ✓. 표시 개수=Task 4/5/10 ✓. 알림 임계값(severity=Task 4/10, importance=Task 5/10) ✓. 카테고리 필터=Task 5/10 ✓. LLM on/off=Task 6/7/10 ✓.
- **타입 일관성:** `EmailSettings`/`EMAIL_SETTINGS_DEFAULTS`/`meetsSeverity`/`meetsImportance`/`isSyncDue`/`isDigestDue` 시그니처가 정의(Task 2)와 사용처(Task 4·5·12·13)에서 일치. `getReplyNeeded`/`getImportantEmails`는 `limitOverride?` 단일 시그니처로 통일. cron payload는 `PollPayload`/`DigestPayload` 명시 타입.
- **알려진 리스크 & 분기:**
  - ① entities→entities import 경계: Task 4 Step 4 lint에서 검증. 위반 시 Step 5 opts 주입 분기 — 이 경우 Task 5/11/13 호출부도 opts 전달형으로 조정(각 Task 노트에 명시됨).
  - ② `_schema.ts`의 `server-only`가 vitest에서 문제 시 Task 8 Step 3에서 기존 integration test 패턴 확인 후 mock 적용.
  - ③ `lastDigestSentDate` date 컬럼 mode: Task 13 Step 2에서 string 추론 확인, 아니면 schema에 `mode:"string"` 명시.
  - ④ `var(--color-surface-2)` 토큰 존재 여부: globals.css 확인(없으면 `--color-surface`로 대체) — 시각만 영향, 빌드 무관.
```
