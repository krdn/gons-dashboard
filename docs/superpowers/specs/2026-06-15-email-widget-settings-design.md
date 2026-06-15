# Email 위젯 설정 기능 — 설계 (Design Spec)

- **날짜**: 2026-06-15
- **브랜치**: `feat/email-widget-settings`
- **상태**: 승인됨 (brainstorming 완료)

## 1. 배경 & 목표

Email 도메인(Gmail 폴링 → LLM 분류 → 위젯 표시·푸시)의 동작값이 코드 전반에
하드코딩되어 있다. 사용자가 위젯에서 직접 다음을 제어할 수 있게 한다:

1. **시간 설정** — ① 아침 다이제스트 발송 시각 ② 동기화 주기 ③ 조회 시간 윈도우
2. **바로 작동하기** — ① 지금 동기화(Sync now: Gmail 폴링+분류 1회) ② 재분류(Reclassify: fetch 없이 기존 메일 LLM 재분류)
3. 그 외 합리적 설정 — 위젯 표시 개수, 알림 임계값, important 카테고리 필터, LLM 분류 on/off

### 직전 컨텍스트 (통합 대상)

이전 세션에서 "Gmail 폴링 4주 멈춤 장애" 복구 후, 위젯에서 수동 트리거하는
`RefreshInboxButton` + `refreshInbox` Server Action 작업이 진행 중이었으나 디스크에
저장되지 않았다(커밋·stash 없음). 이 수동 트리거 요구는 본 설계의 **"지금 동기화"**
기능과 동일하므로 **별도 작업 없이 본 설계에 흡수**한다.

### 설계 불변식 (가장 중요)

- `getEmailSettings(userId)`는 **항상 완전한 설정 객체를 반환**한다. DB row가 없으면
  코드 상수 `EMAIL_SETTINGS_DEFAULTS`를 반환. 위젯/cron/분류기가 모두 이 단일 소스를
  통해 설정을 읽는다 → "하드코딩 값 분산" 문제 해소.
- `EMAIL_SETTINGS_DEFAULTS`는 **현재 하드코딩 값과 동일**하다. 설정을 한 번도
  건드리지 않은 사용자는 동작 변화가 없다(안전한 점진 도입).

## 2. 아키텍처 (FSD)

```
신규:
├── shared/lib/db/schema/email.ts       # emailSettings 테이블 추가
├── entities/email-settings/            # 설정 조회 + 기본값 머지 (별도 슬라이스)
│   ├── model/types.ts                  # EmailSettings 타입 + EMAIL_SETTINGS_DEFAULTS + 순수 헬퍼
│   ├── api/getEmailSettings.ts         # server: row 없으면 DEFAULTS
│   ├── index.ts                        # server entrypoint (import "server-only")
│   └── client.ts                       # 타입 + DEFAULTS + 순수 헬퍼만 (client 안전)
├── features/email-settings-manage/
│   ├── api/_schema.ts                  # Zod (EmailSettingsInput)
│   ├── api/updateEmailSettings.ts      # "use server"
│   ├── api/syncNowAction.ts            # "use server" → syncInbox
│   ├── api/reclassifyAction.ts         # "use server" → reclassifyRecent
│   ├── ui/SettingsGearButton.tsx       # "use client" ⚙ 트리거
│   ├── ui/EmailSettingsDialog.tsx      # "use client" 다이얼로그 셸
│   ├── ui/EmailSettingsForm.tsx        # "use client" 폼 본체
│   ├── index.ts                        # server entrypoint (있다면)
│   └── client.ts                       # Server Action + UI re-export

수정:
├── entities/email/api/getReplyNeeded.ts      # 설정값 파라미터화 (내부에서 settings 읽기)
├── entities/email/api/getImportantEmails.ts  # 설정값 파라미터화
├── features/gmail-sync/api/syncInbox.ts       # LLM on/off + 분류 옵션 주입
├── features/gmail-sync/api/reclassifyRecent.ts # client.ts seam 노출 (Server Action 호출용)
├── widgets/email-digest/ui/EmailDigestCard.tsx       # 헤더에 ⚙ 버튼
├── widgets/important-emails/ui/ImportantEmailsCard.tsx # 헤더에 ⚙ 버튼
├── app/api/cron/poll-gmail/route.ts           # syncInterval due 체크
└── app/api/cron/morning-digest/route.ts       # digest due 체크 + lastDigestSentDate

운영(별도 배포 필요):
└── apps/cron/scheduler.js   # "0 * * * *" → "*/15 * * * *" (poll + digest 둘 다)
```

**FSD seam 준수 (메모리 #7, Gotcha #7)**: server-only 함수와 `"use server"` Server
Action을 같은 barrel에 섞지 않는다. `"use client"` 컴포넌트는 `client.ts`로만 import.
PR 전 `cd apps/dashboard && pnpm build` 1회 필수.

## 3. 데이터 모델 (`email_settings`)

```typescript
// shared/lib/db/schema/email.ts
export const emailSettings = pgTable("email_settings", {
  userId: uuid("user_id").primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),

  // 조회 시점 설정 (저장 즉시 위젯 반영)
  replyNeededLimit:       integer("reply_needed_limit").notNull().default(5),    // 1-50
  importantLimit:         integer("important_limit").notNull().default(10),      // 1-50
  windowDays:             integer("window_days").notNull().default(7),           // 1-90 (두 위젯 공통)

  // 알림 임계값
  replySeverityThreshold: text("reply_severity_threshold").notNull().default("med"), // high|med|low
  importantThreshold:     text("important_threshold").notNull().default("med"),       // high|med

  // important 카테고리 필터 (보여줄 카테고리)
  categories: jsonb("categories").$type<Category[]>().notNull()
    .default(["money","security","schedule","notice"]),

  // LLM 분류 on/off
  llmReplyEnabled:        boolean("llm_reply_enabled").notNull().default(true),
  llmImportantEnabled:    boolean("llm_important_enabled").notNull().default(true),

  // 동기화 주기 / 다이제스트 (cron이 실행 시점에 읽음)
  syncIntervalMinutes:    integer("sync_interval_minutes").notNull().default(60), // 15|30|60|180|360
  digestEnabled:          boolean("digest_enabled").notNull().default(true),
  digestHourKst:          integer("digest_hour_kst").notNull().default(8),         // 0-23
  lastDigestSentDate:     date("last_digest_sent_date"),                            // KST 날짜 'YYYY-MM-DD', due 멱등성

  createdAt: timestamp("created_at", {mode:"date"}).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", {mode:"date"}).notNull().defaultNow(),
});
```

**결정 근거**

- `userId`를 PK로 → user당 1행 보장(별도 unique index 불필요).
- `windowDays` 단일 값 — 사용자에게 "최근 며칠 메일"은 하나의 개념. reply/important
  분리는 YAGNI(실제 필요 발생 시 분리).
- `categories` jsonb 배열 — 가변 길이 필터, 순서 무의미. Drizzle `$type<Category[]>()`.
- `lastDigestSentDate` — cron이 자주 돌 때 "오늘 이미 보냈는지" 멱등성 키. `date` 타입에
  KST 날짜 문자열 저장(timestamptz::date IMMUTABLE 함정 회피 — Gotcha #9).

## 4. 설정 적용 흐름

### A. 조회 시점 (위젯 — 저장 즉시 반영)

`getReplyNeeded(userId)` / `getImportantEmails(userId)`는 시그니처를 단순 유지하되
**내부에서 `getEmailSettings(userId)`를 1회 읽어** 적용:

- `getReplyNeeded`: limit=`replyNeededLimit`, window=`windowDays`,
  severity 순위(high>med>low)가 `replySeverityThreshold` 이상인 행만.
- `getImportantEmails`: limit=`importantLimit`, window=`windowDays`,
  importance가 `importantThreshold` 이상 + `category = ANY(categories)`.

> 호환성: 기존 호출부가 `getReplyNeeded(userId, 5)`처럼 limit을 넘기는 경우, 명시
> 인자가 있으면 그것을 우선(설정은 미지정 시 fallback). morning-digest의
> `getReplyNeeded(userId, 5)`는 현행 유지(다이제스트는 항상 5건 요약). 위젯 호출부는
> limit 인자를 제거해 설정이 적용되게 한다.

위젯은 `getReplyNeeded(userId)` 호출 → `updateEmailSettings`의 `revalidatePath`가
RSC를 재실행 → 새 설정으로 재조회. **즉시 반영.**

### B. 분류 시점 (LLM on/off)

`syncInbox` 분류 루프 진입 전 설정 1회 조회 → 루프에 옵션 전달:

- `llmReplyEnabled === false` → `classifyThread`가 deterministic만 사용.
- `llmImportantEnabled === false` → important 분류 skip.

### C. Cron (실행 시점 due 체크)

`scheduler.js`: `"0 * * * *"` → `"*/15 * * * *"` (poll-gmail, digest 둘 다 15분마다 깨어남).

- **poll-gmail**: perTarget에서 settings 읽고 `isSyncDue(now, user.lastSyncAt, syncIntervalMinutes)`
  아니면 `{kind:"skipped-not-due"}` 즉시 반환. due면 `syncInbox` + `users.lastSyncAt` 갱신.
- **morning-digest → email-digest cron**: perTarget에서
  `isDigestDue(nowKst, digestEnabled, digestHourKst, lastDigestSentDate)` → 발송 +
  `lastDigestSentDate = 오늘(KST)` 갱신. (멱등: 같은 날 재실행 시 skip)

cron 자체는 자주 돌고 **설정은 매 실행 시 DB에서 읽어 반영** → scheduler.js 재배포 없이
사용자가 주기/시각 변경 가능. (단, 15분 주기로의 scheduler.js 변경은 1회 운영 배포 필요)

## 5. UI (다이얼로그)

**트리거**: 두 위젯 헤더 우상단 `⚙` 버튼(`SettingsGearButton`). 클릭 → 공유
`EmailSettingsDialog` 오픈.

**구성** (섹션 그룹):

```
이메일 설정
 ▸ 표시        조회 기간[7]일 / 답장 필요[5]개 / 중요 메일[10]개
 ▸ 알림        아침 다이제스트[on] / 발송 시각[08]:00 KST / 답장 민감도(high·med·low)
 ▸ 중요 필터   카테고리(금전·보안·일정·공지 체크) / 중요도(med이상·high만)
 ▸ 분류 엔진   답장 LLM[on] / 중요 LLM[on]
 ▸ 동기화      주기[1시간▾] / [지금 동기화] [재분류]
 [취소] [저장]
```

- **저장**: `updateEmailSettings` → upsert → `revalidatePath` → 위젯 즉시 갱신.
- **지금 동기화**: `syncNowAction` → `syncInbox(userId)` 1회 → 토스트("N건 분류"/실패 시 "재로그인 필요").
- **재분류**: `reclassifyAction` → `reclassifyRecent`(fetch 없이 LLM 재분류) → 토스트.
- 두 버튼 `useTransition` pending 표시.
- 라이트모드 고정 + 디자인 토큰(`globals.css`) 준수. 시각 표시는 locale-free(Gotcha #3).

## 6. 에러 처리

- 모든 Server Action: discriminated union `{ok:true,...} | {ok:false, code, message?}`.
  `react-error-boundaries` lint 규칙 준수 — try/catch 안 JSX 금지, `.then(success, failure)`
  패턴(메모리 `react-error-boundaries-lint-rule`).
- 입력 검증: Zod(`EmailSettingsInput`) — 범위 밖 값 거부. code: `UNAUTHORIZED` |
  `INVALID_INPUT` | `DB_ERROR`.
- Sync now 실패(reauth-required): 토스트로 "재로그인 필요" 안내(throw 금지).

## 7. 테스트

순수 단위 테스트 우선(통합은 `TEST_DATABASE_URL` 필요 — Gotcha #2):

- `getEmailSettings`: row 없을 때 `EMAIL_SETTINGS_DEFAULTS` 반환.
- 임계값 필터 헬퍼: `meetsSeverity('med', threshold)` 등 순위 비교(순수 함수).
- `EmailSettingsInput` Zod 경계값(0/91일, 0/51개, hour -1/24).
- due 헬퍼 순수 함수: `isSyncDue`, `isDigestDue` (시각/lastSyncAt/lastDigestSentDate 조합).

## 8. 검증 게이트

```
cd apps/dashboard && pnpm typecheck && pnpm lint && pnpm build
```

`pnpm build` 필수 — client/server barrel seam(Gotcha #7)은 typecheck/lint로 못 잡음.
DB 마이그레이션: `pnpm db:generate` → 운영 적용은 별도(Gotcha #9 timestamptz 주의는
본 테이블엔 해당 없음, `date` 컬럼은 KST 날짜 문자열 저장).

## 9. 범위 밖 (YAGNI)

- LLM 모델 선택 UI(haiku 고정 유지).
- poll/digest 동시성 사용자 설정(1인 사용자라 무의미).
- reply/important 윈도우 분리.
- 다이제스트 발송 채널 추가(현행 web-push 유지).

## 10. 작업 순서 (구현 플랜에서 상세화)

1. schema + migration (`emailSettings`)
2. `entities/email-settings` (types/DEFAULTS/헬퍼 + getEmailSettings + seam)
3. `entities/email` 조회 함수 설정 적용
4. `features/email-settings-manage` Server Actions + Zod
5. UI(Dialog/Form/GearButton) + 위젯 헤더 배치
6. cron due 체크 (`isSyncDue`/`isDigestDue` + route 수정)
7. scheduler.js 15분 주기 (운영 배포 항목)
8. 테스트 + 검증 게이트
