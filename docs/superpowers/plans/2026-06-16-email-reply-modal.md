# 이메일 답장 모달 + 즉시 발송 + 모델 선택 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 인라인 답장 편집기를 모달로 교체하고, 톤별 3개 초안 동시 생성·즉시 발송(2단계 확인)·초안용 LLM 모델 선택 설정을 추가한다.

**Architecture:** 백엔드 인프라(`createDraft`, thread fetch, LLM 초안)는 대부분 존재. 신규는 ① `sendDraft`(drafts.send) ② `sendReply` Server Action ③ 톤·모델 파라미터화된 `draftReply` ④ `reply_model` 설정(entity+schema+UI) ⑤ 모달 UI 3종. 발송은 `createDraft`→`sendDraft` 2-step으로 기존 인프라 재사용. 모델은 haiku 금지·gemini 기본.

**Tech Stack:** Next.js 16 (RSC + Server Actions), TypeScript strict, Drizzle ORM, Vitest, Tailwind v4, `@krdn/llm-gateway`.

**선행 설계:** `docs/superpowers/specs/2026-06-16-email-reply-modal-design.md`

---

## 작업 순서 개요

1. **Task 1–3**: 모델 레지스트리 + env (순수 메타 → server 레지스트리 → env)
2. **Task 4–5**: `draftReply` 톤·길이·모델 파라미터화 + 거절 패턴 감지
3. **Task 6–7**: DB 컬럼 `reply_model` + entity 설정 매핑
4. **Task 8–9**: 설정 schema/update/form UI
5. **Task 10**: `sendDraft` gmail 함수
6. **Task 11–12**: `generateReplyDraft` 톤 3개 병렬(길이 인자) + `sendReply` Server Action
7. **Task 13–16**: 모달 UI (컨테이너·본문·발송확인·ReplyCard 연결, 길이 selector 포함)
8. **Task 17**: 빌드 검증 + 인라인 컴포넌트 제거 확인

> **길이(length) 처리**: `draftReply`는 length 파라미터 보유(Task 5). `generateReplyDraft(threadId, length)`로 모달이 선택한 길이를 전달(Task 11). 모달에 길이 selector(짧게/보통/길게) — 변경 시 전체 재생성(Task 14).

각 Task는 독립 커밋. **DB 통합 테스트는 `TEST_DATABASE_URL` 필요** (Gotcha #2). 명령은 `apps/dashboard`에서 실행 (`cd apps/dashboard`).

---

## Task 1: 모델 메타 (순수, client/server safe)

`saju-model-registry-meta.ts` 패턴을 reply 도메인으로 미러. 키·라벨·벤더·추천 플래그·파서. server-only 아님 — UI가 직접 import.

**Files:**
- Create: `apps/dashboard/src/entities/email-settings/model/replyModel.ts`
- Test: `apps/dashboard/src/entities/email-settings/model/replyModel.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/dashboard/src/entities/email-settings/model/replyModel.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  REPLY_MODEL_KEYS,
  REPLY_MODEL_META,
  DEFAULT_REPLY_MODEL_KEY,
  parseReplyModelKey,
} from "./replyModel";

describe("replyModel registry", () => {
  it("기본값은 gemini (추천·검증된 모델)", () => {
    expect(DEFAULT_REPLY_MODEL_KEY).toBe("gemini");
  });

  it("gemini만 recommended=true", () => {
    expect(REPLY_MODEL_META.gemini.recommended).toBe(true);
    expect(REPLY_MODEL_META.codex.recommended).toBe(false);
    expect(REPLY_MODEL_META.claude.recommended).toBe(false);
  });

  it("claude 라벨은 Opus (haiku 아님 — 거절 발생원 제외)", () => {
    expect(REPLY_MODEL_META.claude.label).toContain("Opus");
  });

  it("3개 키 모두 메타 존재", () => {
    for (const k of REPLY_MODEL_KEYS) {
      expect(REPLY_MODEL_META[k].label).toBeTruthy();
      expect(REPLY_MODEL_META[k].vendor).toBeTruthy();
    }
  });

  it("parseReplyModelKey: 유효값 통과", () => {
    expect(parseReplyModelKey("codex")).toBe("codex");
  });

  it("parseReplyModelKey: 잘못된 값은 기본값 폴백", () => {
    expect(parseReplyModelKey("bogus")).toBe("gemini");
    expect(parseReplyModelKey(undefined)).toBe("gemini");
    expect(parseReplyModelKey(42)).toBe("gemini");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/dashboard && pnpm vitest run src/entities/email-settings/model/replyModel.test.ts`
Expected: FAIL — `Cannot find module './replyModel'`

- [ ] **Step 3: 구현 작성**

Create `apps/dashboard/src/entities/email-settings/model/replyModel.ts`:

```typescript
// 답장 초안 생성 모델 선택 메타 — client/server 양쪽 import 안전 (순수).
// env 접근 / 실제 모델 ID 해석은 shared/lib/llm/reply-model-registry.ts (server-only).
// 정책 (spec 2026-06-16): haiku 티어는 이메일 작성 거절 → 레지스트리에서 제외.
//   gemini(추천)·codex·claude(=opus) 만 허용. 경험적 검증 완료.

export const REPLY_MODEL_KEYS = ["gemini", "codex", "claude"] as const;
export type ReplyModelKey = (typeof REPLY_MODEL_KEYS)[number];

export interface ReplyModelMeta {
  label: string;
  vendor: string;
  recommended: boolean;
  description: string;
}

export const REPLY_MODEL_META: Record<ReplyModelKey, ReplyModelMeta> = {
  gemini: {
    label: "Gemini 2.5 Pro",
    vendor: "Google",
    recommended: true,
    description: "자연스러운 답장, 저비용·고속 — 권장",
  },
  codex: {
    label: "Codex (GPT-5)",
    vendor: "OpenAI",
    recommended: false,
    description: "대안 모델. 간결한 톤",
  },
  claude: {
    label: "Claude Opus 4.8",
    vendor: "Anthropic",
    recommended: false,
    description: "고품질이나 비용이 높음",
  },
};

export const DEFAULT_REPLY_MODEL_KEY: ReplyModelKey = "gemini";

// raw 값을 안전하게 ReplyModelKey 로 정규화. Never throws.
export function parseReplyModelKey(raw: unknown): ReplyModelKey {
  if (typeof raw !== "string") return DEFAULT_REPLY_MODEL_KEY;
  return (REPLY_MODEL_KEYS as readonly string[]).includes(raw)
    ? (raw as ReplyModelKey)
    : DEFAULT_REPLY_MODEL_KEY;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd apps/dashboard && pnpm vitest run src/entities/email-settings/model/replyModel.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/entities/email-settings/model/replyModel.ts apps/dashboard/src/entities/email-settings/model/replyModel.test.ts
git commit -m "feat(email-settings): 답장 모델 메타 레지스트리 (gemini 추천, haiku 제외)"
```

---

## Task 2: env 변수 추가

reply 도메인 자체 env 변수 (saju 변수 재사용 금지 — 도메인 결합 회피).

**Files:**
- Modify: `apps/dashboard/src/shared/config/env.ts` (SAJU_LLM_MODEL_GEMINI 블록 근처, line 43 이후)
- Modify: `apps/dashboard/.env.example`

- [ ] **Step 1: env.ts에 변수 추가**

`apps/dashboard/src/shared/config/env.ts`에서 `SAJU_LLM_MODEL_GEMINI: z.string().default("gemini-2.5-pro"),` 줄(line 43) 바로 다음에 추가:

```typescript
  // 답장 초안 모델 (spec 2026-06-16) — saju 와 분리된 자체 변수 (도메인 결합 회피).
  // claude 키는 resolveClaudeModel() 런타임 해석이라 env 불필요.
  REPLY_LLM_MODEL_GEMINI: z.string().default("gemini-2.5-pro"),
  REPLY_LLM_MODEL_CODEX: z.string().default("gpt-5.3-codex"),
```

- [ ] **Step 2: .env.example에 문서화**

`apps/dashboard/.env.example`의 Saju LLM 변수 근처에 추가 (값은 default와 동일):

```
# 답장 초안 모델 (선택 — 미설정 시 default 사용)
REPLY_LLM_MODEL_GEMINI=gemini-2.5-pro
REPLY_LLM_MODEL_CODEX=gpt-5.3-codex
```

- [ ] **Step 3: typecheck 통과 확인**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS (env 타입 추론 정상)

- [ ] **Step 4: 커밋**

```bash
git add apps/dashboard/src/shared/config/env.ts apps/dashboard/.env.example
git commit -m "feat(email-settings): REPLY_LLM_MODEL_* env 변수 (saju 분리)"
```

---

## Task 3: 모델 레지스트리 (server-only, env→ID 해석)

`saju-model-registry.ts` 패턴. claude는 `resolveClaudeModel()` 런타임 해석, gemini/codex는 env.

**Files:**
- Create: `apps/dashboard/src/shared/lib/llm/reply-model-registry.ts`
- Test: `apps/dashboard/src/shared/lib/llm/reply-model-registry.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/dashboard/src/shared/lib/llm/reply-model-registry.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("@/shared/config/env", () => ({
  env: {
    REPLY_LLM_MODEL_GEMINI: "gemini-test-id",
    REPLY_LLM_MODEL_CODEX: "codex-test-id",
  },
}));

vi.mock("./resolve-claude-model", () => ({
  resolveClaudeModel: vi.fn(async () => "claude-opus-resolved"),
}));

import { resolveReplyModelId } from "./reply-model-registry";

describe("resolveReplyModelId", () => {
  it("gemini → env 값", async () => {
    expect(await resolveReplyModelId("gemini")).toBe("gemini-test-id");
  });
  it("codex → env 값", async () => {
    expect(await resolveReplyModelId("codex")).toBe("codex-test-id");
  });
  it("claude → resolveClaudeModel() (opus, haiku 아님)", async () => {
    expect(await resolveReplyModelId("claude")).toBe("claude-opus-resolved");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/dashboard && pnpm vitest run src/shared/lib/llm/reply-model-registry.test.ts`
Expected: FAIL — `Cannot find module './reply-model-registry'`

- [ ] **Step 3: 구현 작성**

Create `apps/dashboard/src/shared/lib/llm/reply-model-registry.ts`:

```typescript
// 답장 초안 모델 키 → 실제 모델 ID 해석 (server-only).
// saju-model-registry.ts 패턴. claude 는 resolveClaudeModel() 로 최신 opus 자동 선택
// (haiku 금지 — 거절 발생원). gemini/codex 는 정적 env.
import "server-only";
import { env } from "@/shared/config/env";
import { resolveClaudeModel } from "./resolve-claude-model";
import type { ReplyModelKey } from "@/entities/email-settings/model/replyModel";

export async function resolveReplyModelId(key: ReplyModelKey): Promise<string> {
  switch (key) {
    case "gemini":
      return env.REPLY_LLM_MODEL_GEMINI;
    case "codex":
      return env.REPLY_LLM_MODEL_CODEX;
    case "claude":
      return resolveClaudeModel();
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd apps/dashboard && pnpm vitest run src/shared/lib/llm/reply-model-registry.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/shared/lib/llm/reply-model-registry.ts apps/dashboard/src/shared/lib/llm/reply-model-registry.test.ts
git commit -m "feat(llm): reply-model-registry — 키→모델ID 해석 (claude=opus)"
```

---

## Task 4: draftReply 거절 패턴 감지 (순수 함수)

CLI 정체성 누수 문구를 감지하는 순수 함수. 발송 차단용 안전망.

**Files:**
- Modify: `apps/dashboard/src/shared/lib/llm/draft-reply.ts`
- Modify: `apps/dashboard/src/shared/lib/llm/draft-reply.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`apps/dashboard/src/shared/lib/llm/draft-reply.test.ts` 파일 끝에 추가:

```typescript
import { isRefusalDraft } from "./draft-reply";

describe("isRefusalDraft", () => {
  it("CLI 정체성 거절 문구 감지", () => {
    expect(
      isRefusalDraft("I appreciate you reaching out, but I'm Claude Code, Anthropic's CLI tool"),
    ).toBe(true);
    expect(isRefusalDraft("I'm not able to help with composing email")).toBe(true);
  });
  it("정상 한국어 답장은 false", () => {
    expect(isRefusalDraft("안녕하세요, 보내주신 메일 잘 받았습니다. 참여하고 싶습니다.")).toBe(false);
  });
  it("일반어 '코딩'·'software engineering' 포함해도 정상이면 false (오탐 방지)", () => {
    expect(isRefusalDraft("코딩 교육 문의에 답변드립니다. 참여 가능합니다.")).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/dashboard && pnpm vitest run src/shared/lib/llm/draft-reply.test.ts -t isRefusalDraft`
Expected: FAIL — `isRefusalDraft is not exported`

- [ ] **Step 3: 구현 추가**

`apps/dashboard/src/shared/lib/llm/draft-reply.ts`에 추가 (`languageInstruction` 함수 위, import 아래):

```typescript
// CLI 정체성 누수 거절 감지 — 발송/저장 차단용 안전망.
// CLI 정체성에 특이적인 문구만 (일반어 "코딩"·"software engineering"은 오탐이라 제외).
const REFUSAL_PATTERNS = [
  "i'm claude code",
  "i am claude code",
  "anthropic's cli",
  "claude code, anthropic",
  "not able to help with composing",
  "i'm not able to help with",
];

export function isRefusalDraft(body: string): boolean {
  const lower = body.toLowerCase();
  return REFUSAL_PATTERNS.some((p) => lower.includes(p));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd apps/dashboard && pnpm vitest run src/shared/lib/llm/draft-reply.test.ts`
Expected: PASS (전체 — 기존 + isRefusalDraft 3개)

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/shared/lib/llm/draft-reply.ts apps/dashboard/src/shared/lib/llm/draft-reply.test.ts
git commit -m "feat(llm): isRefusalDraft — CLI 정체성 거절 감지 안전망"
```

---

## Task 5: draftReply 톤·길이·모델 파라미터화

`draftReply`에 tone·length·modelId 추가. 톤·길이별 system prompt 분기. 모델은 호출자가 ID 주입.

**Files:**
- Modify: `apps/dashboard/src/shared/lib/llm/draft-reply.ts`
- Modify: `apps/dashboard/src/shared/lib/llm/draft-reply.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`draft-reply.test.ts`에 추가:

```typescript
import { toneInstruction } from "./draft-reply";

describe("toneInstruction", () => {
  it("polite → 정중", () => {
    expect(toneInstruction("polite", "medium")).toContain("정중");
  });
  it("concise → 간결 + 짧게", () => {
    const r = toneInstruction("concise", "short");
    expect(r).toContain("간결");
    expect(r).toContain("짧");
  });
  it("friendly → 친근", () => {
    expect(toneInstruction("friendly", "long")).toContain("친근");
  });
});

describe("draftReply with tone/model", () => {
  it("modelId를 analyzeStructured에 전달", async () => {
    mockAnalyze.mockResolvedValueOnce({ object: { body: "안녕하세요." } } as never);
    await draftReply({
      fromEmail: "a@b.com",
      subject: "test",
      bodyText: "내용",
      severity: "med",
      language: "ko",
      tone: "polite",
      length: "medium",
      modelId: "gemini-2.5-pro",
    });
    const call = mockAnalyze.mock.calls.at(-1)!;
    expect((call[2] as { model: string }).model).toBe("gemini-2.5-pro");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/dashboard && pnpm vitest run src/shared/lib/llm/draft-reply.test.ts -t "tone"`
Expected: FAIL — `toneInstruction is not exported` / 타입 에러

- [ ] **Step 3: 구현 수정**

`apps/dashboard/src/shared/lib/llm/draft-reply.ts` 수정:

(a) import에 HAIKU_MODEL 제거하고 gatewayDefaults만 유지:

```typescript
import { gatewayDefaults } from "./anthropic";
```

(b) `DraftReplyInput` 인터페이스에 필드 추가:

```typescript
export interface DraftReplyInput {
  fromEmail: string;
  fromName?: string;
  subject: string;
  bodyText: string;
  severity: "high" | "med" | "low";
  language: "auto" | "ko" | "en" | "ja" | "zh";
  tone: "polite" | "concise" | "friendly";
  length: "short" | "medium" | "long";
  /** reply-model-registry 가 해석한 실제 모델 ID. */
  modelId: string;
}
```

(c) `languageInstruction` 함수 다음에 추가:

```typescript
// 톤·길이 지시문. tone=문체, length=분량.
export function toneInstruction(
  tone: "polite" | "concise" | "friendly",
  length: "short" | "medium" | "long",
): string {
  const toneText =
    tone === "polite"
      ? "정중하고 격식 있는 문체로 작성합니다."
      : tone === "concise"
        ? "간결하고 사무적인 문체로 작성합니다."
        : "친근하고 부드러운 문체로 작성합니다.";
  const lengthText =
    length === "short"
      ? "분량은 짧게 (2~3문장)."
      : length === "long"
        ? "분량은 충분히 (6문장 이상, 필요한 세부 포함)."
        : "분량은 보통 (4~5문장).";
  return `${toneText} ${lengthText}`;
}
```

(d) `draftReply` 함수 내 `systemPrompt` 구성과 `analyzeStructured` 호출 수정:

```typescript
  const systemPrompt = `${SYSTEM_PROMPT}\n\n${languageInstruction(input.language)}\n${toneInstruction(input.tone, input.length)}`;

  try {
    const { object } = await analyzeStructured(userPrompt, ResponseSchema, {
      ...gatewayDefaults,
      model: input.modelId,
      systemPrompt,
      maxOutputTokens: 1000,
    });
    return { kind: "ok", body: object.body };
  } catch (error) {
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd apps/dashboard && pnpm vitest run src/shared/lib/llm/draft-reply.test.ts`
Expected: PASS (기존 테스트는 `tone`/`length`/`modelId` 누락으로 깨질 수 있음 → Step 5에서 수정)

- [ ] **Step 5: 기존 테스트 시그니처 보정**

`draft-reply.test.ts`의 기존 `draftReply({...})` 호출에 `tone: "polite", length: "medium", modelId: "test-model"` 추가 (누락 필드 채움). 다시 실행:

Run: `cd apps/dashboard && pnpm vitest run src/shared/lib/llm/draft-reply.test.ts`
Expected: PASS (전체)

- [ ] **Step 6: 커밋**

```bash
git add apps/dashboard/src/shared/lib/llm/draft-reply.ts apps/dashboard/src/shared/lib/llm/draft-reply.test.ts
git commit -m "feat(llm): draftReply 톤·길이·모델 파라미터화 (HAIKU 하드코딩 제거)"
```

---

## Task 6: DB 컬럼 reply_model 추가

`email_settings.reply_model` 컬럼. drizzle schema + 마이그레이션 생성.

**Files:**
- Modify: `apps/dashboard/src/shared/lib/db/schema/email.ts:153` (replyLanguage 다음)

- [ ] **Step 1: schema에 컬럼 추가**

`apps/dashboard/src/shared/lib/db/schema/email.ts`의 `replyLanguage` 줄(line 153) 바로 다음에 추가:

```typescript
  replyModel: text("reply_model").notNull().default("gemini"), // 'gemini'|'codex'|'claude'
```

- [ ] **Step 2: 마이그레이션 생성**

Run: `cd apps/dashboard && pnpm db:generate`
Expected: 새 마이그레이션 파일 생성 (`drizzle/XXXX_*.sql`에 `ALTER TABLE "email_settings" ADD COLUMN "reply_model"`)

생성된 SQL 확인:
Run: `ls -t apps/dashboard/drizzle/*.sql | head -1 | xargs cat`
Expected: `ADD COLUMN "reply_model" text DEFAULT 'gemini' NOT NULL` 포함

> 스냅샷 id 충돌 시(`pointing to a parent snapshot ... collision`): 메모리 `drizzle-snapshot-id-collision` 참조 — 충돌 snapshot.json의 `id`/`prevId` 수정.

- [ ] **Step 3: typecheck**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add apps/dashboard/src/shared/lib/db/schema/email.ts apps/dashboard/drizzle/
git commit -m "feat(email-settings): reply_model 컬럼 + 마이그레이션"
```

---

## Task 7: entity 설정 매핑 (types + getEmailSettings)

`EmailSettings`에 `replyModel` 추가, 기본값·getEmailSettings 매핑.

**Files:**
- Modify: `apps/dashboard/src/entities/email-settings/model/types.ts`
- Modify: `apps/dashboard/src/entities/email-settings/api/getEmailSettings.ts`

- [ ] **Step 1: types.ts 수정**

`apps/dashboard/src/entities/email-settings/model/types.ts`:

(a) 상단 import에 ReplyModelKey 추가:

```typescript
import type { ReplyModelKey } from "./replyModel";
```

(b) `EmailSettings` 인터페이스의 `replyLanguage: ReplyLanguage;` 다음에 추가:

```typescript
  replyModel: ReplyModelKey;
```

(c) `EMAIL_SETTINGS_DEFAULTS`의 `replyLanguage: "auto",` 다음에 추가:

```typescript
  replyModel: "gemini",
```

- [ ] **Step 2: getEmailSettings.ts 수정**

`apps/dashboard/src/entities/email-settings/api/getEmailSettings.ts`:

(a) import에 ReplyModelKey 추가:

```typescript
import {
  EMAIL_SETTINGS_DEFAULTS,
  type EmailSettings,
  type ReplyLanguage,
} from "../model/types";
import type { ReplyModelKey } from "../model/replyModel";
```

(b) return 객체의 `replyLanguage: row.replyLanguage as ReplyLanguage,` 다음에 추가:

```typescript
      replyModel: row.replyModel as ReplyModelKey,
```

- [ ] **Step 3: typecheck**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add apps/dashboard/src/entities/email-settings/model/types.ts apps/dashboard/src/entities/email-settings/api/getEmailSettings.ts
git commit -m "feat(email-settings): EmailSettings에 replyModel 매핑"
```

---

## Task 8: 설정 schema + update Action

`_schema.ts` Zod enum, `updateEmailSettings` formData 수집.

**Files:**
- Modify: `apps/dashboard/src/features/email-settings-manage/api/_schema.ts:32`
- Modify: `apps/dashboard/src/features/email-settings-manage/api/updateEmailSettings.ts:31`
- Modify: `apps/dashboard/src/features/email-settings-manage/api/_schema.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`apps/dashboard/src/features/email-settings-manage/api/_schema.test.ts`에 추가 (기존 describe 내 또는 신규):

```typescript
import { EmailSettingsInput } from "./_schema";

describe("replyModel 검증", () => {
  const base = {
    replyNeededLimit: "5", importantLimit: "10", windowDays: "7",
    replySeverityThreshold: "med", importantThreshold: "med",
    categories: ["money"], syncIntervalMinutes: "60", digestHourKst: "8",
    replyLanguage: "auto",
  };
  it("유효한 replyModel 통과", () => {
    const r = EmailSettingsInput.safeParse({ ...base, replyModel: "codex" });
    expect(r.success).toBe(true);
  });
  it("미지정 시 gemini 기본값", () => {
    const r = EmailSettingsInput.safeParse(base);
    expect(r.success && r.data.replyModel).toBe("gemini");
  });
  it("잘못된 값 거부", () => {
    const r = EmailSettingsInput.safeParse({ ...base, replyModel: "gpt4" });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/dashboard && pnpm vitest run src/features/email-settings-manage/api/_schema.test.ts -t replyModel`
Expected: FAIL — replyModel 필드 없음

- [ ] **Step 3: _schema.ts에 enum 추가**

`apps/dashboard/src/features/email-settings-manage/api/_schema.ts`의 `replyLanguage: z.enum(...)` 줄(line 32) 다음에 추가:

```typescript
  replyModel: z.enum(["gemini", "codex", "claude"]).default("gemini"),
```

- [ ] **Step 4: updateEmailSettings.ts에 수집 추가**

`apps/dashboard/src/features/email-settings-manage/api/updateEmailSettings.ts`의 `raw` 객체에서 `replyLanguage: formData.get("replyLanguage"),` 줄(line 31) 다음에 추가:

```typescript
    replyModel: formData.get("replyModel"),
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd apps/dashboard && pnpm vitest run src/features/email-settings-manage/api/_schema.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add apps/dashboard/src/features/email-settings-manage/api/_schema.ts apps/dashboard/src/features/email-settings-manage/api/updateEmailSettings.ts apps/dashboard/src/features/email-settings-manage/api/_schema.test.ts
git commit -m "feat(email-settings): replyModel Zod enum + formData 수집"
```

---

## Task 9: 설정 UI — 모델 select + 추천 배지

`EmailSettingsForm.tsx`에 모델 select 추가. 답장 언어 select 바로 아래.

**Files:**
- Modify: `apps/dashboard/src/features/email-settings-manage/ui/EmailSettingsForm.tsx:198` (답장 언어 label 닫는 곳 다음)

- [ ] **Step 1: import + select 추가**

`apps/dashboard/src/features/email-settings-manage/ui/EmailSettingsForm.tsx` 상단 import에 추가:

```typescript
import {
  REPLY_MODEL_KEYS,
  REPLY_MODEL_META,
} from "@/entities/email-settings/model/replyModel";
```

답장 언어 `</label>` (line 198) 다음, `</div>` (line 199) 앞에 새 블록 추가:

```tsx
        <div className="mt-3">
          <label className="block">
            <span className={labelCls}>답장 초안 모델</span>
            <select
              name="replyModel"
              defaultValue={s.replyModel}
              className={inputCls}
            >
              {REPLY_MODEL_KEYS.map((k) => (
                <option key={k} value={k}>
                  {REPLY_MODEL_META[k].label}
                  {REPLY_MODEL_META[k].recommended ? " ⭐ 권장" : ""}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
              {REPLY_MODEL_META[s.replyModel].description}
            </span>
          </label>
        </div>
```

> 주의: `s.replyModel`이 `EmailSettings` 타입에 있어야 함 (Task 7 완료 전제). 설명 텍스트는 현재 선택값 기준 정적 표시(서버 렌더). 동적 갱신은 범위 밖.

- [ ] **Step 2: typecheck + lint**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 3: 커밋**

```bash
git add apps/dashboard/src/features/email-settings-manage/ui/EmailSettingsForm.tsx
git commit -m "feat(email-settings): 답장 초안 모델 select + 추천 배지 UI"
```

---

## Task 10: gmail sendDraft 함수

`drafts.send` 호출. `createDraft`와 같은 파일 패턴. errors 재사용.

**Files:**
- Create: `apps/dashboard/src/shared/api/gmail/send.ts`
- Test: `apps/dashboard/src/shared/api/gmail/send.test.ts`
- Modify: `apps/dashboard/src/shared/api/gmail/index.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/dashboard/src/shared/api/gmail/send.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendDraft } from "./send";
import { GmailScopeError } from "./errors";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => fetchMock.mockReset());

describe("sendDraft", () => {
  it("성공 → sentMessageId 반환", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "msg-1", threadId: "t-1" }), { status: 200 }),
    );
    const r = await sendDraft("token", "draft-1");
    expect(r.sentMessageId).toBe("msg-1");
    // drafts/send 엔드포인트 + draftId 전송 확인
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/drafts/send");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ id: "draft-1" });
  });

  it("403 → GmailScopeError", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 403, message: "insufficient" } }), { status: 403 }),
    );
    await expect(sendDraft("token", "draft-1")).rejects.toBeInstanceOf(GmailScopeError);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/dashboard && pnpm vitest run src/shared/api/gmail/send.test.ts`
Expected: FAIL — `Cannot find module './send'`

- [ ] **Step 3: 구현 작성**

Create `apps/dashboard/src/shared/api/gmail/send.ts`:

```typescript
// Gmail drafts.send — 기존 초안을 발송.
// createDraft 로 만든 draftId 를 전송 → Gmail 이 스레딩/헤더 보존한 채 발송.
// scope: gmail.modify 가 drafts.send 를 허용 (Google 문서 검증 2026-06-16).
import "server-only";
import { z } from "zod";
import { classifyGmailError } from "./errors";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

const SendResponseSchema = z.object({
  id: z.string(),
  threadId: z.string().optional(),
});

export interface SendDraftResult {
  sentMessageId: string;
}

export async function sendDraft(
  accessToken: string,
  draftId: string,
): Promise<SendDraftResult> {
  const response = await fetch(`${API}/drafts/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: draftId }),
  });
  if (!response.ok) {
    throw await classifyGmailError(response);
  }
  const parsed = SendResponseSchema.parse(await response.json());
  return { sentMessageId: parsed.id };
}
```

- [ ] **Step 4: index.ts에 export 추가**

`apps/dashboard/src/shared/api/gmail/index.ts`의 `createDraft` export 줄 다음에 추가:

```typescript
export { sendDraft } from "./send";
export type { SendDraftResult } from "./send";
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd apps/dashboard && pnpm vitest run src/shared/api/gmail/send.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: 커밋**

```bash
git add apps/dashboard/src/shared/api/gmail/send.ts apps/dashboard/src/shared/api/gmail/send.test.ts apps/dashboard/src/shared/api/gmail/index.ts
git commit -m "feat(gmail): sendDraft — drafts.send (gmail.modify scope)"
```

---

## Task 11: generateReplyDraft 톤 3개 병렬 생성 (길이 인자)

기존 단일 초안 → 톤 3개 병렬. 반환 타입 변경. 모델은 settings.replyModel 라우팅. **length 파라미터 추가** (모달 selector 값).

**Files:**
- Modify: `apps/dashboard/src/features/email-reply/api/generateReplyDraft.ts`

- [ ] **Step 1: import + 모델 해석 추가**

`apps/dashboard/src/features/email-reply/api/generateReplyDraft.ts`:

(a) import 추가:

```typescript
import { draftReply, isRefusalDraft } from "@/shared/lib/llm/draft-reply";
import { resolveReplyModelId } from "@/shared/lib/llm/reply-model-registry";
```

- [ ] **Step 2: 반환 타입 변경**

`GenerateReplyResult`의 `ok` variant 수정 — 단일 body → drafts 배열:

```typescript
export type ReplyTone = "polite" | "concise" | "friendly";
export type ReplyLength = "short" | "medium" | "long";

export interface ToneDraft {
  tone: ReplyTone;
  body: string;
  /** isRefusalDraft 감지 시 true → UI 발송/저장 차단. */
  refusal: boolean;
}

export type GenerateReplyResult =
  | {
      kind: "ok";
      drafts: ToneDraft[];
      meta: {
        gmailThreadId: string;
        toEmail: string;
        subject: string;
        inReplyTo: string;
        references: string;
        originalBody: string;
      };
    }
  | { kind: "llm-unavailable" }
  | { kind: "scope-required" };
```

- [ ] **Step 3: 본문 — 톤 3개 병렬 호출로 교체**

함수 시그니처에 length 파라미터 추가 (기본값 medium — 인자 없는 기존 호출 호환):

```typescript
export async function generateReplyDraft(
  threadId: string,
  length: ReplyLength = "medium",
): Promise<GenerateReplyResult> {
```

기존 `// 5. 사용자 설정에서 답장 언어 조회` 부터 함수 끝(`return { kind: "ok", ... }`)까지를 다음으로 교체:

```typescript
  // 5. 사용자 설정 (언어 + 모델).
  const settings = await getEmailSettings(userId);
  const modelId = await resolveReplyModelId(settings.replyModel);

  // 6. 톤 3개 병렬 LLM 초안 (길이는 모달 선택값).
  const tones: ReplyTone[] = ["polite", "concise", "friendly"];
  const results = await Promise.all(
    tones.map((tone) =>
      draftReply({
        fromEmail: row.fromEmail ?? "",
        fromName: row.fromName ?? undefined,
        subject: row.subject ?? "",
        bodyText,
        severity: row.severity as "high" | "med" | "low",
        language: settings.replyLanguage,
        tone,
        length,
        modelId,
      }).then((r) => ({ tone, result: r })),
    ),
  );

  // 전부 실패면 llm-unavailable.
  const oks = results.filter((r) => r.result.kind === "ok");
  if (oks.length === 0) return { kind: "llm-unavailable" };

  const drafts: ToneDraft[] = oks.map((r) => {
    const body = (r.result as { kind: "ok"; body: string }).body;
    return { tone: r.tone, body, refusal: isRefusalDraft(body) };
  });

  return {
    kind: "ok",
    drafts,
    meta: {
      gmailThreadId: row.gmailThreadId,
      toEmail: extractEmail(toEmail) || (row.fromEmail ?? ""),
      subject: row.subject ?? "",
      inReplyTo: messageId,
      references: existingRefs ? `${existingRefs} ${messageId}`.trim() : messageId,
      originalBody: bodyText,
    },
  };
```

> 주의: 기존 `import { draftReply }`와 `import { getEmailSettings }`가 중복 import되지 않게 Step 1에서 draftReply import 줄을 교체(추가가 아니라 수정). getEmailSettings는 기존 줄 유지.

- [ ] **Step 4: barrel에 신규 타입 export**

`apps/dashboard/src/features/email-reply/client.ts`의 `export type { GenerateReplyResult } ...` 줄을 다음으로 교체(타입 추가):

```typescript
export { generateReplyDraft } from "./api/generateReplyDraft";
export type {
  GenerateReplyResult,
  ReplyTone,
  ReplyLength,
  ToneDraft,
} from "./api/generateReplyDraft";
```

`apps/dashboard/src/features/email-reply/index.ts`도 동일하게 타입 export 추가:

```typescript
export type {
  GenerateReplyResult,
  ReplyTone,
  ReplyLength,
  ToneDraft,
} from "./api/generateReplyDraft";
```

- [ ] **Step 5: typecheck**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: FAIL — saveReplyDraft/ReplyComposer가 옛 `body`/`meta` 형태 참조 (Task 12·13·16에서 해소). **generateReplyDraft.ts·client.ts 자체 타입 에러는 없어야 함.**

generateReplyDraft.ts만 타입 확인:
Run: `cd apps/dashboard && npx tsc --noEmit 2>&1 | grep generateReplyDraft || echo "generateReplyDraft clean"`
Expected: `generateReplyDraft clean`

- [ ] **Step 6: 커밋**

```bash
git add apps/dashboard/src/features/email-reply/api/generateReplyDraft.ts apps/dashboard/src/features/email-reply/client.ts apps/dashboard/src/features/email-reply/index.ts
git commit -m "feat(email-reply): generateReplyDraft 톤 3개 병렬 + 길이 인자 + 모델 라우팅 + refusal 플래그"
```

---

## Task 12: sendReply Server Action

`saveReplyDraft` 패턴 미러 + `createDraft`→`sendDraft`. 소유권 재검증.

**Files:**
- Create: `apps/dashboard/src/features/email-reply/api/sendReply.ts`
- Modify: `apps/dashboard/src/features/email-reply/client.ts`
- Modify: `apps/dashboard/src/features/email-reply/index.ts`
- Test: `apps/dashboard/src/features/email-reply/api/sendReply.test.ts`

- [ ] **Step 1: 실패 테스트 작성 (소유권 재검증 — 통합)**

Create `apps/dashboard/src/features/email-reply/api/sendReply.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("@/shared/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/shared/lib/db/client", () => ({
  db: { select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => [] }) }) }) }) },
}));

import { sendReply } from "./sendReply";

describe("sendReply 소유권", () => {
  it("소유하지 않은 threadId → Thread not found throw", async () => {
    await expect(
      sendReply("not-owned", "본문", {
        gmailThreadId: "x", toEmail: "a@b.com", subject: "s", inReplyTo: "", references: "",
      }),
    ).rejects.toThrow("Thread not found");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/dashboard && pnpm vitest run src/features/email-reply/api/sendReply.test.ts`
Expected: FAIL — `Cannot find module './sendReply'`

- [ ] **Step 3: 구현 작성**

Create `apps/dashboard/src/features/email-reply/api/sendReply.ts`:

```typescript
// 편집된 답장 본문 → Gmail 초안 생성 후 즉시 발송. DB 무저장.
// createDraft → sendDraft 2-step (기존 draft 인프라 재사용).
// 소유권은 DB의 gmailThreadId 로 재검증 (클라이언트 meta 불신).
"use server";

import "server-only";
import { and, eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { emailThreads, replyNeeded } from "@/shared/lib/db/schema";
import {
  getValidAccessToken,
  createDraft,
  sendDraft,
  GmailScopeError,
} from "@/shared/api/gmail";
import type { SaveDraftMeta } from "./saveReplyDraft";

export type SendReplyResult =
  | { kind: "ok"; sentMessageId: string }
  | { kind: "scope-required" }
  | { kind: "send-failed" };

export async function sendReply(
  threadId: string,
  editedBody: string,
  meta: SaveDraftMeta,
): Promise<SendReplyResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const userId = session.user.id;

  // 소유권 재확인 — gmailThreadId 는 DB 값을 신뢰 (meta 위변조 방지).
  const owned = await db
    .select({ gmailThreadId: emailThreads.gmailThreadId })
    .from(replyNeeded)
    .innerJoin(emailThreads, eq(replyNeeded.threadId, emailThreads.id))
    .where(and(eq(replyNeeded.threadId, threadId), eq(replyNeeded.userId, userId)))
    .limit(1);

  if (owned.length === 0) throw new Error("Thread not found");
  const gmailThreadId = owned[0].gmailThreadId;

  const { accessToken } = await getValidAccessToken(userId);

  try {
    const draft = await createDraft(accessToken, {
      gmailThreadId,
      toEmail: meta.toEmail,
      subject: meta.subject,
      inReplyTo: meta.inReplyTo,
      references: meta.references,
      body: editedBody,
    });
    const sent = await sendDraft(accessToken, draft.draftId);
    return { kind: "ok", sentMessageId: sent.sentMessageId };
  } catch (error) {
    if (error instanceof GmailScopeError) return { kind: "scope-required" };
    return { kind: "send-failed" };
  }
}
```

- [ ] **Step 4: barrel export 추가**

`apps/dashboard/src/features/email-reply/client.ts`에 추가:

```typescript
export { sendReply } from "./api/sendReply";
export type { SendReplyResult } from "./api/sendReply";
```

`apps/dashboard/src/features/email-reply/index.ts`에 추가:

```typescript
export { sendReply } from "./api/sendReply";
export type { SendReplyResult } from "./api/sendReply";
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd apps/dashboard && pnpm vitest run src/features/email-reply/api/sendReply.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add apps/dashboard/src/features/email-reply/api/sendReply.ts apps/dashboard/src/features/email-reply/api/sendReply.test.ts apps/dashboard/src/features/email-reply/client.ts apps/dashboard/src/features/email-reply/index.ts
git commit -m "feat(email-reply): sendReply Server Action — createDraft→sendDraft"
```

---

## Task 13: SendConfirmDialog 컴포넌트

발송 2단계 확인 다이얼로그. 받는사람·제목·본문 미리보기 + 보내기/취소.

**Files:**
- Create: `apps/dashboard/src/widgets/email-digest/ui/SendConfirmDialog.tsx`

- [ ] **Step 1: 구현 작성**

Create `apps/dashboard/src/widgets/email-digest/ui/SendConfirmDialog.tsx`:

```tsx
"use client";

// 발송 2단계 확인 — 받는사람·제목·본문 미리보기 후 최종 발송.
// 외부로 나가는 비가역 액션이라 명시적 확인 게이트 (spec §4.3).
import { useId } from "react";

interface SendConfirmDialogProps {
  toEmail: string;
  subject: string;
  body: string;
  isSending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SendConfirmDialog({
  toEmail,
  subject,
  body,
  isSending,
  onConfirm,
  onCancel,
}: SendConfirmDialogProps) {
  const titleId = useId();
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-elev)]"
        onClick={(e) => e.stopPropagation()}
      >
        <p id={titleId} className="mb-3 text-sm font-semibold text-[var(--color-text)]">
          이 답장을 발송할까요?
        </p>
        <dl className="mb-3 space-y-1 text-xs text-[var(--color-text-muted)]">
          <div>
            받는사람: <b className="text-[var(--color-text)]">{toEmail}</b>
          </div>
          <div>제목: {subject}</div>
        </dl>
        <div className="mb-4 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-text)]">
          {body}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSending}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-40"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSending}
            className="rounded-md bg-[var(--color-text)] px-3 py-1.5 text-xs font-medium text-[var(--color-surface)] transition-colors hover:opacity-80 disabled:opacity-40"
          >
            {isSending ? "발송 중…" : "보내기"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: typecheck + lint**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: PASS (generateReplyDraft 소비처 에러는 Task 14~15 후 해소 — 이 파일 자체는 clean)

- [ ] **Step 3: 커밋**

```bash
git add apps/dashboard/src/widgets/email-digest/ui/SendConfirmDialog.tsx
git commit -m "feat(email-digest): SendConfirmDialog 발송 확인 다이얼로그"
```

---

## Task 14: ReplyModalBody — 탭·편집·필드·상태머신

모달 내용. 톤 3개 탭(독립 편집), To/CC/BCC·제목 필드, 원본 본문, 저장/발송. refusal 차단.

**Files:**
- Create: `apps/dashboard/src/widgets/email-digest/ui/ReplyModalBody.tsx`

- [ ] **Step 1: 구현 작성**

Create `apps/dashboard/src/widgets/email-digest/ui/ReplyModalBody.tsx`:

```tsx
"use client";

// 모달 내용 — 톤 3개 탭(편집 독립 보존) + 필드 + 저장/발송.
// 상태: loading → editing → saved | sent | error.
// refusal 탭은 저장·발송 차단 (CLI 정체성 거절 안전망).
import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  generateReplyDraft,
  saveReplyDraft,
  sendReply,
} from "@/features/email-reply/client";
import type {
  GenerateReplyResult,
  ReplyTone,
  ReplyLength,
} from "@/features/email-reply/client";
import { SendConfirmDialog } from "./SendConfirmDialog";

type OkResult = Extract<GenerateReplyResult, { kind: "ok" }>;
type Meta = OkResult["meta"];

const LENGTH_LABEL: Record<ReplyLength, string> = {
  short: "짧게",
  medium: "보통",
  long: "길게",
};

type Status =
  | { phase: "loading" }
  | { phase: "editing"; meta: Meta }
  | { phase: "error"; message: string }
  | { phase: "saved" }
  | { phase: "sent" };

const TONE_LABEL: Record<ReplyTone, string> = {
  polite: "정중",
  concise: "간결",
  friendly: "친근",
};

interface ReplyModalBodyProps {
  threadId: string;
  onClose: () => void;
  onSent: () => void;
}

export function ReplyModalBody({ threadId, onClose, onSent }: ReplyModalBodyProps) {
  const [status, setStatus] = useState<Status>({ phase: "loading" });
  // 톤별 본문 (탭 독립 편집 보존)
  const [bodies, setBodies] = useState<Record<ReplyTone, string>>({
    polite: "",
    concise: "",
    friendly: "",
  });
  const [refusals, setRefusals] = useState<Record<ReplyTone, boolean>>({
    polite: false,
    concise: false,
    friendly: false,
  });
  const [activeTone, setActiveTone] = useState<ReplyTone>("polite");
  const [availableTones, setAvailableTones] = useState<ReplyTone[]>([]);
  // 길이 selector — 변경 시 전체 재생성. ref로 최신값 읽어 stale closure 회피.
  const [length, setLength] = useState<ReplyLength>("medium");
  const lengthRef = useRef<ReplyLength>("medium");
  const [toEmail, setToEmail] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const [originalBody, setOriginalBody] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const labelId = useId();
  const requestIdRef = useRef(0);

  function runGenerate() {
    const id = ++requestIdRef.current;
    generateReplyDraft(threadId, lengthRef.current).then(
      (result) => {
        if (id !== requestIdRef.current) return;
        if (result.kind === "ok") {
          const nextBodies = { polite: "", concise: "", friendly: "" };
          const nextRefusals = { polite: false, concise: false, friendly: false };
          for (const d of result.drafts) {
            nextBodies[d.tone] = d.body;
            nextRefusals[d.tone] = d.refusal;
          }
          setBodies(nextBodies);
          setRefusals(nextRefusals);
          const tones = result.drafts.map((d) => d.tone);
          setAvailableTones(tones);
          setActiveTone(tones[0] ?? "polite");
          setToEmail(result.meta.toEmail);
          setSubject(result.meta.subject);
          setOriginalBody(result.meta.originalBody);
          setStatus({ phase: "editing", meta: result.meta });
        } else if (result.kind === "scope-required") {
          setStatus({ phase: "error", message: "Gmail 쓰기 권한이 없습니다. 재로그인 해주세요." });
        } else {
          setStatus({ phase: "error", message: "초안 생성에 실패했습니다. 다시 시도하세요." });
        }
      },
      () => {
        if (id !== requestIdRef.current) return;
        setStatus({ phase: "error", message: "초안 생성 중 오류가 발생했습니다." });
      },
    );
  }

  useEffect(() => {
    runGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  function handleRegenerate() {
    setStatus({ phase: "loading" });
    runGenerate();
  }

  // 길이 변경 — ref 즉시 갱신 후 전체 재생성 (3개 톤 모두 새 길이로).
  function handleLengthChange(next: ReplyLength) {
    lengthRef.current = next;
    setLength(next);
    setStatus({ phase: "loading" });
    runGenerate();
  }

  function buildMeta(meta: Meta): Meta {
    // To/제목은 사용자 편집값 반영. CC/BCC는 buildRfc822 확장(Task 15-후속) — 현재 meta 그대로.
    return { ...meta, toEmail, subject };
  }

  function handleSave(meta: Meta) {
    const body = bodies[activeTone];
    startTransition(() =>
      saveReplyDraft(threadId, body, buildMeta(meta)).then(
        (result) => {
          if (result.kind === "ok") setStatus({ phase: "saved" });
          else if (result.kind === "scope-required")
            setStatus({ phase: "error", message: "Gmail 쓰기 권한이 없습니다. 재로그인 해주세요." });
          else setStatus({ phase: "error", message: "초안 저장에 실패했습니다." });
        },
        () => setStatus({ phase: "error", message: "저장 중 오류가 발생했습니다." }),
      ),
    );
  }

  function handleSend(meta: Meta) {
    const body = bodies[activeTone];
    startTransition(() =>
      sendReply(threadId, body, buildMeta(meta)).then(
        (result) => {
          setConfirmOpen(false);
          if (result.kind === "ok") {
            setStatus({ phase: "sent" });
            onSent();
          } else if (result.kind === "scope-required")
            setStatus({ phase: "error", message: "Gmail 쓰기 권한이 없습니다. 재로그인 해주세요." });
          else setStatus({ phase: "error", message: "발송에 실패했습니다. 다시 시도하세요." });
        },
        () => {
          setConfirmOpen(false);
          setStatus({ phase: "error", message: "발송 중 오류가 발생했습니다." });
        },
      ),
    );
  }

  if (status.phase === "loading")
    return <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">✦ AI 초안 생성 중…</p>;

  if (status.phase === "saved")
    return (
      <div className="py-6 text-center text-sm text-[var(--color-text-muted)]">
        ✓ Gmail 초안함에 저장됐습니다.
        <button type="button" onClick={onClose} className="ml-3 underline">닫기</button>
      </div>
    );

  if (status.phase === "sent")
    return (
      <div className="py-6 text-center text-sm text-[var(--color-text-muted)]">
        ✓ 답장을 발송했습니다.
        <button type="button" onClick={onClose} className="ml-3 underline">닫기</button>
      </div>
    );

  if (status.phase === "error")
    return (
      <div className="py-6 text-center">
        <p role="status" className="text-sm text-[var(--color-severity-high)]">{status.message}</p>
        <button
          type="button"
          onClick={handleRegenerate}
          className="mt-3 rounded-md border border-[var(--color-hairline)] px-3 py-1.5 text-xs font-medium"
        >
          다시 시도
        </button>
      </div>
    );

  const { meta } = status;
  const currentRefusal = refusals[activeTone];
  const blocked = isPending || currentRefusal || bodies[activeTone].trim() === "";

  return (
    <div className="text-sm">
      {/* 필드 */}
      <div className="mb-3 space-y-2">
        <Field label="받는사람" value={toEmail} onChange={setToEmail} />
        <Field label="참조 (CC)" value={cc} onChange={setCc} placeholder="선택" />
        <Field label="숨은참조 (BCC)" value={bcc} onChange={setBcc} placeholder="선택" />
        <Field label="제목" value={subject} onChange={setSubject} />
      </div>

      {/* 원본 본문 토글 */}
      <button
        type="button"
        onClick={() => setShowOriginal((v) => !v)}
        className="mb-2 text-xs text-[var(--color-text-muted)] underline"
      >
        원본 메일 {showOriginal ? "숨기기" : "보기"}
      </button>
      {showOriginal && (
        <div className="mb-3 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
          {originalBody || "(본문 없음)"}
        </div>
      )}

      {/* 길이 selector — 변경 시 전체 재생성 */}
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs text-[var(--color-text-muted)]">길이</span>
        <div className="flex gap-1">
          {(["short", "medium", "long"] as ReplyLength[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => handleLengthChange(l)}
              disabled={isPending}
              aria-pressed={length === l}
              className={[
                "rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-40",
                length === l
                  ? "bg-[var(--color-accent)] text-[var(--color-surface)]"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]",
              ].join(" ")}
            >
              {LENGTH_LABEL[l]}
            </button>
          ))}
        </div>
      </div>

      {/* 톤 탭 */}
      <div role="tablist" className="mb-2 flex gap-1">
        {availableTones.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={activeTone === t}
            type="button"
            onClick={() => setActiveTone(t)}
            className={[
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              activeTone === t
                ? "bg-[var(--color-text)] text-[var(--color-surface)]"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]",
              refusals[t] ? "line-through opacity-60" : "",
            ].join(" ")}
          >
            {TONE_LABEL[t]}
          </button>
        ))}
      </div>

      <p id={labelId} className="sr-only">답장 본문 ({TONE_LABEL[activeTone]})</p>
      <textarea
        value={bodies[activeTone]}
        onChange={(e) => setBodies((b) => ({ ...b, [activeTone]: e.target.value }))}
        rows={8}
        aria-labelledby={labelId}
        className="w-full resize-y rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-2)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
      />

      {currentRefusal && (
        <p role="status" className="mt-1 text-xs text-[var(--color-severity-high)]">
          ⚠️ 이 초안은 비정상입니다(AI 거절 응답). 다시 생성하거나 다른 톤을 선택하세요.
        </p>
      )}

      {/* 버튼 */}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={blocked}
          className="rounded-md bg-[var(--color-text)] px-3 py-1.5 text-xs font-medium text-[var(--color-surface)] hover:opacity-80 disabled:opacity-40"
        >
          발송
        </button>
        <button
          type="button"
          onClick={() => handleSave(meta)}
          disabled={blocked}
          className="rounded-md border border-[var(--color-hairline)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-surface-2)] disabled:opacity-40"
        >
          Gmail 초안 저장
        </button>
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={isPending}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] disabled:opacity-40"
        >
          다시 생성
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={isPending}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] disabled:opacity-40"
        >
          취소
        </button>
      </div>

      {confirmOpen && (
        <SendConfirmDialog
          toEmail={toEmail}
          subject={subject}
          body={bodies[activeTone]}
          isSending={isPending}
          onConfirm={() => handleSend(meta)}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-[var(--color-text-muted)]">{label}</span>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 rounded-md border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
      />
    </label>
  );
}
```

> CC/BCC 입력은 받지만 실제 헤더 전송은 `buildRfc822` 확장이 필요. 현 계획에선 **UI 수집까지** 구현하고, 헤더 반영은 Task 15에서 처리.

- [ ] **Step 2: typecheck**

Run: `cd apps/dashboard && pnpm typecheck 2>&1 | grep ReplyModalBody || echo "ReplyModalBody clean"`
Expected: `ReplyModalBody clean`

- [ ] **Step 3: 커밋**

```bash
git add apps/dashboard/src/widgets/email-digest/ui/ReplyModalBody.tsx
git commit -m "feat(email-digest): ReplyModalBody — 톤 탭·필드·저장·발송·refusal 차단"
```

---

## Task 15: CC/BCC 헤더 전송 (buildRfc822 + meta 확장)

CC/BCC를 실제 발송에 반영. `DraftParams`·`buildRfc822`·meta·Server Action 확장.

**Files:**
- Modify: `apps/dashboard/src/shared/api/gmail/drafts.ts`
- Modify: `apps/dashboard/src/shared/api/gmail/drafts.test.ts`
- Modify: `apps/dashboard/src/features/email-reply/api/saveReplyDraft.ts`
- Modify: `apps/dashboard/src/features/email-reply/api/sendReply.ts`
- Modify: `apps/dashboard/src/widgets/email-digest/ui/ReplyModalBody.tsx`

- [ ] **Step 1: drafts.test.ts에 CC/BCC 테스트 추가**

`apps/dashboard/src/shared/api/gmail/drafts.test.ts`의 `buildRfc822` describe에 추가:

```typescript
it("cc/bcc 있으면 Cc/Bcc 헤더 추가, 없으면 생략", () => {
  const withCc = buildRfc822({
    gmailThreadId: "t", toEmail: "a@b.com", subject: "s",
    inReplyTo: "", references: "", body: "본문", cc: "c@d.com", bcc: "e@f.com",
  });
  expect(withCc).toContain("Cc: c@d.com");
  expect(withCc).toContain("Bcc: e@f.com");

  const without = buildRfc822({
    gmailThreadId: "t", toEmail: "a@b.com", subject: "s",
    inReplyTo: "", references: "", body: "본문",
  });
  expect(without).not.toContain("Cc:");
  expect(without).not.toContain("Bcc:");
});

it("cc/bcc CRLF 인젝션 제거", () => {
  const raw = buildRfc822({
    gmailThreadId: "t", toEmail: "a@b.com", subject: "s",
    inReplyTo: "", references: "", body: "본문",
    cc: "c@d.com\r\nBcc: evil@x.com",
  });
  // 줄바꿈 제거되어 헤더 인젝션 무력화
  expect(raw).not.toContain("Bcc: evil@x.com");
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/dashboard && pnpm vitest run src/shared/api/gmail/drafts.test.ts -t "cc/bcc"`
Expected: FAIL — cc/bcc 필드 타입 없음

- [ ] **Step 3: drafts.ts 수정**

`DraftParams`에 추가:

```typescript
export interface DraftParams {
  gmailThreadId: string;
  toEmail: string;
  subject: string;
  inReplyTo: string;
  references: string;
  body: string;
  /** 참조 — 빈 값이면 헤더 생략. */
  cc?: string;
  /** 숨은참조 — 빈 값이면 헤더 생략. */
  bcc?: string;
}
```

`buildRfc822`에서 `To:` 헤더 push 다음, `Subject:` 앞 또는 inReplyTo 블록 근처에 CC/BCC 추가 (headers 배열 push 순서: To 다음):

```typescript
  const headers = [
    `To: ${sanitizeHeader(params.toEmail)}`,
    `Subject: ${encodeSubject(params.subject)}`,
  ];
  if (params.cc) {
    headers.push(`Cc: ${sanitizeHeader(params.cc)}`);
  }
  if (params.bcc) {
    headers.push(`Bcc: ${sanitizeHeader(params.bcc)}`);
  }
  if (params.inReplyTo) {
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd apps/dashboard && pnpm vitest run src/shared/api/gmail/drafts.test.ts`
Expected: PASS

- [ ] **Step 5: SaveDraftMeta에 cc/bcc 추가 + Server Action 전달**

`apps/dashboard/src/features/email-reply/api/saveReplyDraft.ts`의 `SaveDraftMeta`에 추가:

```typescript
export interface SaveDraftMeta {
  gmailThreadId: string;
  toEmail: string;
  subject: string;
  inReplyTo: string;
  references: string;
  cc?: string;
  bcc?: string;
}
```

같은 파일 `createDraft` 호출에 `cc: meta.cc, bcc: meta.bcc,` 추가:

```typescript
    const result = await createDraft(accessToken, {
      gmailThreadId,
      toEmail: meta.toEmail,
      subject: meta.subject,
      inReplyTo: meta.inReplyTo,
      references: meta.references,
      body: editedBody,
      cc: meta.cc,
      bcc: meta.bcc,
    });
```

`apps/dashboard/src/features/email-reply/api/sendReply.ts`의 `createDraft` 호출에도 동일하게 `cc: meta.cc, bcc: meta.bcc,` 추가.

- [ ] **Step 6: ReplyModalBody의 buildMeta가 cc/bcc 포함**

`ReplyModalBody.tsx`의 `buildMeta` 수정:

```typescript
  function buildMeta(meta: Meta): Meta {
    return { ...meta, toEmail, subject };
  }
```
→ saveReplyDraft/sendReply에 넘기는 meta에 cc/bcc 포함되도록, `handleSave`/`handleSend`에서 meta 확장:

```typescript
  function metaWithFields(meta: Meta) {
    return { ...meta, toEmail, subject, cc: cc || undefined, bcc: bcc || undefined };
  }
```

그리고 `handleSave`·`handleSend` 내 `buildMeta(meta)` → `metaWithFields(meta)`로 교체, 기존 `buildMeta` 함수 제거.

> 주의: `Meta`(generateReplyDraft의 meta)에는 cc/bcc가 없으므로, `metaWithFields` 반환 타입이 `SaveDraftMeta`와 호환되도록 `saveReplyDraft`/`sendReply` 시그니처가 `SaveDraftMeta`를 받는지 확인. `Meta`와 `SaveDraftMeta`는 cc/bcc 옵셔널 외 동일 → 스프레드로 호환.

- [ ] **Step 7: typecheck + 전체 테스트**

Run: `cd apps/dashboard && pnpm typecheck && pnpm vitest run src/shared/api/gmail/ src/features/email-reply/`
Expected: PASS

- [ ] **Step 8: 커밋**

```bash
git add apps/dashboard/src/shared/api/gmail/drafts.ts apps/dashboard/src/shared/api/gmail/drafts.test.ts apps/dashboard/src/features/email-reply/api/saveReplyDraft.ts apps/dashboard/src/features/email-reply/api/sendReply.ts apps/dashboard/src/widgets/email-digest/ui/ReplyModalBody.tsx
git commit -m "feat(email-reply): CC/BCC 헤더 전송 (buildRfc822 확장 + sanitize)"
```

---

## Task 16: ReplyModal 컨테이너 + ReplyCard 연결 + 인라인 제거

모달 컨테이너(포커스/ESC/오버레이) + ReplyCard를 인라인 토글 → 모달 오픈으로 교체. `ReplyComposer.tsx` 제거.

**Files:**
- Create: `apps/dashboard/src/widgets/email-digest/ui/ReplyModal.tsx`
- Modify: `apps/dashboard/src/widgets/email-digest/ui/ReplyCard.tsx`
- Delete: `apps/dashboard/src/widgets/email-digest/ui/ReplyComposer.tsx`

- [ ] **Step 1: ReplyModal 컨테이너 작성**

Create `apps/dashboard/src/widgets/email-digest/ui/ReplyModal.tsx`:

```tsx
"use client";

// 답장 모달 컨테이너 — 오버레이·ESC 닫기·포커스. 내용은 ReplyModalBody.
import { useEffect, useId, useRef } from "react";
import { ReplyModalBody } from "./ReplyModalBody";

interface ReplyModalProps {
  threadId: string;
  subject: string;
  onClose: () => void;
  onSent: () => void;
}

export function ReplyModal({ threadId, subject, onClose, onSent }: ReplyModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[10vh]"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-elev)] focus:outline-none"
      >
        <p id={titleId} className="mb-3 text-sm font-semibold text-[var(--color-text)]">
          답장 작성 — {subject || "(제목 없음)"}
        </p>
        <ReplyModalBody threadId={threadId} onClose={onClose} onSent={onSent} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: ReplyCard 수정 — 인라인 토글 → 모달**

`apps/dashboard/src/widgets/email-digest/ui/ReplyCard.tsx`:

(a) import 교체 — `ReplyComposer` 제거, `ReplyModal` 추가:

```typescript
import { ReplyModal } from "./ReplyModal";
```

(b) 상태 변수: `isComposing`/`composerId` 의도는 유지하되 모달용으로:

```typescript
  const [isModalOpen, setIsModalOpen] = useState(false);
```
(기존 `isComposing`·`composerId`·`useId` 관련 줄 제거)

(c) 인라인 composer 블록(`{isComposing ? (...) : null}`) 제거.

(d) "답장하기" 버튼을 모달 오픈으로:

```tsx
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="rounded-md bg-[var(--color-text)] px-3 py-1.5 text-xs font-medium text-[var(--color-surface)] transition-colors hover:bg-[oklch(15%_0.01_264)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          답장하기
        </button>
```
(기존 `aria-expanded`/`aria-controls`/`▾▴` 제거)

(e) `</article>` 직전 또는 컴포넌트 return 최상위에 모달 렌더 추가:

```tsx
      {isModalOpen && (
        <ReplyModal
          threadId={item.threadId}
          subject={item.subject ?? ""}
          onClose={() => setIsModalOpen(false)}
          onSent={() => {
            setIsModalOpen(false);
            setIsHidden(true);
            router.refresh();
          }}
        />
      )}
```

> `onSent`은 발송 성공 시 카드를 숨기고 새로고침 (markAsReplied 효과를 클라이언트에서 즉시 반영). 명시적 `markAsReplied` 서버 호출이 필요하면 `runAction(() => markAsReplied(item.threadId))` 사용 가능하나, 발송=답장이므로 위젯에서 제거만으로 충분.

- [ ] **Step 3: ReplyComposer 삭제**

```bash
git rm apps/dashboard/src/widgets/email-digest/ui/ReplyComposer.tsx
```

- [ ] **Step 4: typecheck + lint**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: PASS (ReplyComposer 참조 없어야 함)

ReplyComposer 잔존 참조 확인:
Run: `grep -rn "ReplyComposer" apps/dashboard/src/ || echo "no ReplyComposer refs"`
Expected: `no ReplyComposer refs`

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/widgets/email-digest/ui/ReplyModal.tsx apps/dashboard/src/widgets/email-digest/ui/ReplyCard.tsx
git commit -m "feat(email-digest): ReplyModal + ReplyCard 모달 연결, 인라인 ReplyComposer 제거"
```

---

## Task 17: 전체 빌드 검증 + 회귀 확인

server/client seam은 typecheck+lint로 안 잡힘 → `pnpm build` 필수 (Gotcha #7).

**Files:** (없음 — 검증만)

- [ ] **Step 1: 전체 테스트**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test`
Expected: PASS (DB 통합 미연결분은 ECONNREFUSED 허용 — Gotcha #2)

- [ ] **Step 2: 프로덕션 빌드**

Run: `cd apps/dashboard && pnpm build`
Expected: PASS — `Module not found: tls/net/perf_hooks` 없어야 함 (email-reply client.ts seam 정상)

빌드 실패 시: `features/email-reply/client.ts`가 server-only 함수를 끌어오는지 점검 (Gotcha #7). `sendReply`/`saveReplyDraft`/`generateReplyDraft`는 모두 `"use server"`라 RPC 경계 — client.ts re-export 안전.

- [ ] **Step 3: 최종 커밋 (필요 시)**

빌드 산출물 외 변경 없으면 커밋 불필요. 빌드 고치는 수정이 있었으면:

```bash
git add -A
git commit -m "fix(email-reply): build seam 보정"
```

---

## 자가 점검 (작성 후 — 이미 반영됨)

- **Spec 커버리지**: §3 파일맵→Task 1~16, §5 품질→Task 3·4·5·11, §6 모델설정→Task 1·2·3·6·7·8·9, §4 발송→Task 10·12·13·14, §7 보안(소유권/sanitize)→Task 12·15, §10 테스트→각 Task TDD. 모달 a11y(§9)→Task 13·16(role/ESC/포커스). ✅
- **Placeholder**: drizzle `XXXX_*.sql`는 자동 생성 번호(의도적). 그 외 없음.
- **타입 일관성**: `ReplyModelKey`·`ToneDraft`·`ReplyTone`·`SaveDraftMeta`(cc/bcc)·`Meta` 시그니처 Task 간 일치. `resolveReplyModelId`·`isRefusalDraft`·`toneInstruction`·`sendDraft`·`sendReply` 이름 고정.
- **길이 selector**: 모달에 짧게/보통/길게 selector 추가(Task 14). 변경 시 `generateReplyDraft(threadId, length)`로 전체 재생성(Task 11·14). `lengthRef`로 stale closure 회피. spec §4.2 충족.
- **알려진 한계**: 톤 일부 실패 시 "성공 탭만 표시"는 generateReplyDraft가 성공분만 drafts에 담아 자연 충족(Task 11). 길이는 톤 3개 공통 적용(톤별 개별 길이는 범위 밖 — 불필요한 복잡도).
