# 답장 언어 선택 설정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이메일 설정에서 답장 언어(auto/ko/en/ja/zh)를 선택하면 generateReplyDraft가 그 언어로 초안을 생성한다.

**Architecture:** email_settings에 reply_language 컬럼 추가 → 타입/Zod/폼/getEmailSettings에 필드 전파 → generateReplyDraft가 설정을 읽어 draftReply에 language 전달 → systemPrompt 언어 지시 분기. auto = 원본 메일 언어 맞춤(기본).

**Tech Stack:** Drizzle(컬럼+psql 마이그레이션), Zod, Next.js Server Action, React form, Vitest.

설계 문서: `docs/superpowers/specs/2026-06-16-reply-language-setting-design.md`

---

## File Structure

| 파일 | 변경 | 책임 |
|---|---|---|
| `entities/email-settings/model/types.ts` | 수정 | `ReplyLanguage` 타입 + 필드 + 기본값 |
| `shared/lib/db/schema/email.ts` | 수정 | `replyLanguage` 컬럼 |
| `entities/email-settings/api/getEmailSettings.ts` | 수정 | row→EmailSettings 매핑에 replyLanguage |
| `features/email-settings-manage/api/_schema.ts` | 수정 | Zod enum |
| `features/email-settings-manage/api/updateEmailSettings.ts` | 수정 | formData.get |
| `features/email-settings-manage/ui/EmailSettingsForm.tsx` | 수정 | 언어 select |
| `shared/lib/llm/draft-reply.ts` | 수정 | language 파라미터 + languageInstruction 헬퍼 |
| `features/email-reply/api/generateReplyDraft.ts` | 수정 | getEmailSettings→draftReply language 전달 |
| drizzle 마이그레이션 SQL | 생성 | ADD COLUMN |

---

## Task 1: ReplyLanguage 타입 + 기본값

**Files:**
- Modify: `apps/dashboard/src/entities/email-settings/model/types.ts`
- Test: `apps/dashboard/src/entities/email-settings/model/replyLanguage.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/dashboard/src/entities/email-settings/model/replyLanguage.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { EMAIL_SETTINGS_DEFAULTS, REPLY_LANGUAGES } from "./types";

describe("replyLanguage 설정", () => {
  it("기본값은 auto (기존 사용자 불변식)", () => {
    expect(EMAIL_SETTINGS_DEFAULTS.replyLanguage).toBe("auto");
  });

  it("REPLY_LANGUAGES는 5개 옵션", () => {
    expect(REPLY_LANGUAGES).toEqual(["auto", "ko", "en", "ja", "zh"]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/entities/email-settings/model/replyLanguage.test.ts`
Expected: FAIL — REPLY_LANGUAGES export 없음

- [ ] **Step 3: types.ts 수정**

`types.ts` 상단 import 아래에 추가:

```typescript
export const REPLY_LANGUAGES = ["auto", "ko", "en", "ja", "zh"] as const;
export type ReplyLanguage = (typeof REPLY_LANGUAGES)[number];
```

`EmailSettings` 인터페이스에 필드 추가 (digestHourKst 아래):

```typescript
  replyLanguage: ReplyLanguage;
```

`EMAIL_SETTINGS_DEFAULTS`에 추가 (digestHourKst 아래):

```typescript
  replyLanguage: "auto",
```

- [ ] **Step 4: 통과 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/entities/email-settings/model/replyLanguage.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/entities/email-settings/model/types.ts apps/dashboard/src/entities/email-settings/model/replyLanguage.test.ts
git commit -m "feat(email-settings): ReplyLanguage 타입 + auto 기본값"
```

---

## Task 2: DB 스키마 컬럼 + 마이그레이션

**Files:**
- Modify: `apps/dashboard/src/shared/lib/db/schema/email.ts`
- Generate: drizzle 마이그레이션

- [ ] **Step 1: emailSettings에 컬럼 추가**

`schema/email.ts`의 `emailSettings` pgTable에서 `digestHourKst` 줄 아래에 추가:

```typescript
  replyLanguage: text("reply_language").notNull().default("auto"), // 'auto'|'ko'|'en'|'ja'|'zh'
```

- [ ] **Step 2: 마이그레이션 생성**

Run: `cd apps/dashboard && pnpm db:generate`
Expected: 새 마이그레이션 파일 생성 (ALTER TABLE email_settings ADD COLUMN reply_language).

생성된 SQL을 확인: `git status`로 새 `drizzle/*.sql` 파일 확인 후 내용에 `ADD COLUMN "reply_language" text NOT NULL DEFAULT 'auto'` 포함 확인.

주의: db:generate가 snapshot id collision(메모리 drizzle-snapshot-id-collision)으로 실패하면, 충돌 entry의 0XXX_snapshot.json의 id(새 UUID)+prevId만 수정.

- [ ] **Step 3: typecheck**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add apps/dashboard/src/shared/lib/db/schema/email.ts apps/dashboard/drizzle/
git commit -m "feat(email-settings): reply_language 컬럼 + 마이그레이션"
```

---

## Task 3: getEmailSettings 매핑

**Files:**
- Modify: `apps/dashboard/src/entities/email-settings/api/getEmailSettings.ts`

- [ ] **Step 1: row 매핑에 replyLanguage 추가**

`getEmailSettings.ts`의 return 객체에서 `digestHourKst: row.digestHourKst,` 아래에 추가:

```typescript
      replyLanguage: row.replyLanguage as import("../model/types").ReplyLanguage,
```

(또는 상단 import에 `type ReplyLanguage`를 추가하고 `row.replyLanguage as ReplyLanguage`로. import 스타일은 기존 파일에 맞춰라 — 이미 `type EmailSettings`를 `../model/types`에서 import 중이므로 거기에 `ReplyLanguage` 추가가 깔끔.)

- [ ] **Step 2: typecheck**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS (EmailSettings에 replyLanguage 필수 필드라, 누락 시 에러 났던 게 해소됨)

- [ ] **Step 3: 커밋**

```bash
git add apps/dashboard/src/entities/email-settings/api/getEmailSettings.ts
git commit -m "feat(email-settings): getEmailSettings에 replyLanguage 매핑"
```

---

## Task 4: Zod 스키마 + Server Action

**Files:**
- Modify: `apps/dashboard/src/features/email-settings-manage/api/_schema.ts`
- Modify: `apps/dashboard/src/features/email-settings-manage/api/updateEmailSettings.ts`
- Test: `apps/dashboard/src/features/email-settings-manage/api/_schema.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`_schema.test.ts`에 추가 (기존 파일 — describe 블록 추가):

```typescript
import { describe, it, expect } from "vitest";
import { EmailSettingsInput } from "./_schema";

describe("EmailSettingsInput replyLanguage", () => {
  const base = {
    replyNeededLimit: "5", importantLimit: "10", windowDays: "7",
    replySeverityThreshold: "med", importantThreshold: "med",
    categories: ["money"], syncIntervalMinutes: "60", digestHourKst: "8",
  };

  it("유효한 replyLanguage 통과", () => {
    const r = EmailSettingsInput.safeParse({ ...base, replyLanguage: "en" });
    expect(r.success).toBe(true);
  });

  it("잘못된 replyLanguage 거부", () => {
    const r = EmailSettingsInput.safeParse({ ...base, replyLanguage: "fr" });
    expect(r.success).toBe(false);
  });

  it("미지정 시 auto 기본값", () => {
    const r = EmailSettingsInput.safeParse(base);
    expect(r.success && r.data.replyLanguage).toBe("auto");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/features/email-settings-manage/api/_schema.test.ts`
Expected: FAIL — replyLanguage 미정의라 fr도 통과/auto 없음

- [ ] **Step 3: _schema.ts에 enum 추가**

`EmailSettingsInput` z.object 안, `digestHourKst: intIn(0, 23),` 아래에 추가:

```typescript
  replyLanguage: z.enum(["auto", "ko", "en", "ja", "zh"]).default("auto"),
```

- [ ] **Step 4: updateEmailSettings에 formData.get 추가**

`updateEmailSettings.ts`의 formData 수집 객체에서 `digestHourKst: formData.get("digestHourKst"),` 아래에 추가:

```typescript
    replyLanguage: formData.get("replyLanguage"),
```

(set 구문은 `set: { ...parsed.data }` spread라 자동 포함 — 수정 불필요.)

- [ ] **Step 5: 통과 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/features/email-settings-manage/api/_schema.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add apps/dashboard/src/features/email-settings-manage/api/_schema.ts apps/dashboard/src/features/email-settings-manage/api/updateEmailSettings.ts apps/dashboard/src/features/email-settings-manage/api/_schema.test.ts
git commit -m "feat(email-settings): replyLanguage Zod enum + formData 수집"
```

---

## Task 5: 설정 폼 언어 select

**Files:**
- Modify: `apps/dashboard/src/features/email-settings-manage/ui/EmailSettingsForm.tsx`

- [ ] **Step 1: 언어 select 추가**

먼저 파일을 Read해서 "답장 알림 민감도" select 블록(name="replySeverityThreshold")의 위치를 찾아라. 그 `</label>` 바로 아래에 같은 패턴으로 추가:

```tsx
          <label className="block">
            <span className={labelCls}>답장 언어</span>
            <select
              name="replyLanguage"
              defaultValue={s.replyLanguage}
              className={inputCls}
            >
              <option value="auto">자동 (원문 언어)</option>
              <option value="ko">한국어</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
              <option value="zh">中文</option>
            </select>
          </label>
```

(labelCls/inputCls는 기존 파일에 정의된 클래스 상수 — 그대로 사용. `s`는 `initial ?? EMAIL_SETTINGS_DEFAULTS`라 replyLanguage 항상 존재.)

- [ ] **Step 2: typecheck + lint**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 3: 커밋**

```bash
git add apps/dashboard/src/features/email-settings-manage/ui/EmailSettingsForm.tsx
git commit -m "feat(email-settings): 답장 언어 select 추가"
```

---

## Task 6: draftReply 언어 지시

**Files:**
- Modify: `apps/dashboard/src/shared/lib/llm/draft-reply.ts`
- Test: `apps/dashboard/src/shared/lib/llm/draft-reply.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`draft-reply.test.ts`에 추가 (기존 파일 — describe 블록 추가). 먼저 파일을 Read해서 기존 import/mock 구조 확인:

```typescript
import { languageInstruction } from "./draft-reply";

describe("languageInstruction", () => {
  it("auto는 원본 언어 지시", () => {
    expect(languageInstruction("auto")).toContain("같은 언어");
  });
  it("en은 English 지시", () => {
    expect(languageInstruction("en")).toContain("English");
  });
  it("ko는 한국어 지시", () => {
    expect(languageInstruction("ko")).toContain("한국어");
  });
  it("ja는 日本語 지시", () => {
    expect(languageInstruction("ja")).toContain("日本語");
  });
  it("zh는 中文 지시", () => {
    expect(languageInstruction("zh")).toContain("中文");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/shared/lib/llm/draft-reply.test.ts`
Expected: FAIL — languageInstruction export 없음

- [ ] **Step 3: draft-reply.ts 수정**

상단에 ReplyLanguage import 추가:

```typescript
import type { ReplyLanguage } from "@/entities/email-settings/model/types";
```

`DraftReplyInput` 인터페이스에 필드 추가 (severity 아래):

```typescript
  language: ReplyLanguage;
```

`languageInstruction` 헬퍼 추가 (SYSTEM_PROMPT 정의 위 또는 파일 하단 export):

```typescript
// 답장 언어 지시 — auto는 원본 메일 언어에 맞춤.
export function languageInstruction(language: ReplyLanguage): string {
  switch (language) {
    case "ko":
      return "답장은 반드시 한국어로 작성합니다.";
    case "en":
      return "Write the reply in English.";
    case "ja":
      return "返信は必ず日本語で書いてください。";
    case "zh":
      return "回复必须用中文书写。";
    case "auto":
    default:
      return "답장은 원본 메일과 같은 언어로 작성합니다.";
  }
}
```

SYSTEM_PROMPT는 상수에서 "한국어 답장을 씁니다" 문장을 제거하고, 언어 지시는 런타임에 주입한다. SYSTEM_PROMPT의 2번째 줄을 다음으로 변경:

```
원본 메일의 맥락(제안/질문/요청)을 읽고 적절한 톤으로 답장을 씁니다.
```

(즉 "한국어"를 뺀다.) 그리고 draftReply 함수 안에서 systemPrompt를 동적으로 조립:

```typescript
    const systemPrompt = `${SYSTEM_PROMPT}\n\n${languageInstruction(input.language)}`;
```

`analyzeStructured` 호출의 `systemPrompt: SYSTEM_PROMPT,`를 `systemPrompt,`로 변경.

- [ ] **Step 4: 통과 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/shared/lib/llm/draft-reply.test.ts`
Expected: PASS (기존 2개 + 신규 5개). 단, 기존 테스트가 draftReply 호출 시 language 필드를 안 넘기면 타입 에러 — 기존 테스트 input에 `language: "auto"` 추가.

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/shared/lib/llm/draft-reply.ts apps/dashboard/src/shared/lib/llm/draft-reply.test.ts
git commit -m "feat(llm): draftReply 언어 지시 — languageInstruction 분기"
```

---

## Task 7: generateReplyDraft에서 언어 전달

**Files:**
- Modify: `apps/dashboard/src/features/email-reply/api/generateReplyDraft.ts`

- [ ] **Step 1: getEmailSettings import + 호출**

먼저 파일을 Read. 상단 import에 추가:

```typescript
import { getEmailSettings } from "@/entities/email-settings";
```

(barrel 경로 확인 — `@/entities/email-settings`가 getEmailSettings를 export하는지 Read로 확인. 아니면 정확한 경로로.)

`draftReply` 호출 전에 설정 조회 (userId는 이미 함수 안에 있음):

```typescript
  const settings = await getEmailSettings(userId);
```

(이미 다른 곳에서 settings를 읽고 있으면 재사용. 없으면 draftReply 직전에 추가.)

- [ ] **Step 2: draftReply 호출에 language 전달**

`draftReply({ ... })` 호출 객체에서 `severity: row.severity as ...,` 아래에 추가:

```typescript
    language: settings.replyLanguage,
```

- [ ] **Step 3: typecheck**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add apps/dashboard/src/features/email-reply/api/generateReplyDraft.ts
git commit -m "feat(email-reply): generateReplyDraft가 설정 언어를 draftReply에 전달"
```

---

## Task 8: 전체 검증

- [ ] **Step 1: 전체 신규/관련 테스트**

Run:
```bash
cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/entities/email-settings src/features/email-settings-manage src/shared/lib/llm/draft-reply.test.ts
```
Expected: 신규 테스트 전부 PASS

- [ ] **Step 2: typecheck + lint + build**

Run:
```bash
cd apps/dashboard && pnpm typecheck && pnpm lint && pnpm build
```
Expected: 모두 PASS

- [ ] **Step 3: 마이그레이션 SQL 확인 (운영 적용 준비)**

생성된 `apps/dashboard/drizzle/*.sql` 중 reply_language ADD COLUMN 문을 확인.
운영 적용은 배포 단계에서 psql 직접 실행 (db:migrate 함정 회피):
```sql
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS reply_language text NOT NULL DEFAULT 'auto';
```

---

## 비범위 재확인

- 답장 톤 선택, 메일별 언어 오버라이드, 코드 기반 언어 감지 — 설계 §8 참조.
