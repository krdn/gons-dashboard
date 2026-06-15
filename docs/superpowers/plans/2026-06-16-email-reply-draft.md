# 이메일 답장 초안 생성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "오늘 답장 필요" 위젯의 "답장하기"를 누르면 LLM이 원본 메일 본문을 분석해 답장 초안을 생성하고, 사용자가 인라인 편집한 뒤 Gmail 초안으로 저장한다.

**Architecture:** Gmail `threads.get(format=full)`로 inbound 메시지 본문을 받아 순수 `mime.ts`로 텍스트 추출 → `draftReply` LLM 유틸이 초안 생성 → 사용자가 `ReplyComposer`에서 수정 → `drafts.create`로 Gmail 스레딩 3조건(threadId + In-Reply-To/References + Subject 일치) 충족하며 저장. 대시보드 DB 무저장.

**Tech Stack:** Next.js 16 Server Actions, Drizzle(read-only), `@krdn/llm-gateway` analyzeStructured + Zod, Gmail REST API, Vitest.

설계 문서: `docs/superpowers/specs/2026-06-16-email-reply-draft-design.md`

---

## File Structure

| 파일 | 신규/수정 | 책임 |
|---|---|---|
| `shared/api/gmail/errors.ts` | 수정 | `GmailScopeError`(403 SCOPE) 추가 + 분기 |
| `shared/api/gmail/threads.ts` | 신규 | `getThread(token, gmailThreadId)` — threads.get format=full |
| `shared/api/gmail/mime.ts` | 신규 | 순수. payload → 본문 텍스트 (base64url, multipart, HTML strip, 인용부 절단) |
| `shared/api/gmail/drafts.ts` | 신규 | `createDraft(token, params)` — RFC822 3조건 빌드 + drafts.create |
| `shared/api/gmail/index.ts` | 수정 | 신규 export 추가 |
| `shared/lib/llm/draft-reply.ts` | 신규 | `draftReply(input)` — LLM 초안 생성 |
| `features/email-reply/index.ts` | 신규 | server entrypoint barrel |
| `features/email-reply/api/generateReplyDraft.ts` | 신규 | Server Action — 본문 fetch → LLM → 초안 |
| `features/email-reply/api/saveReplyDraft.ts` | 신규 | Server Action — editedBody → Gmail draft |
| `features/email-reply/client.ts` | 신규 | Server Action client re-export |
| `widgets/email-digest/ui/ReplyComposer.tsx` | 신규 | 인라인 편집기 UI |
| `widgets/email-digest/ui/ReplyCard.tsx` | 수정 | 답장하기 링크 → 토글 버튼 + composer |

---

## Task 1: GmailScopeError 추가 (403 SCOPE 감지)

**Files:**
- Modify: `apps/dashboard/src/shared/api/gmail/errors.ts`
- Test: `apps/dashboard/src/shared/api/gmail/errors.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/dashboard/src/shared/api/gmail/errors.test.ts`에 추가 (없으면 생성):

```typescript
import { describe, it, expect } from "vitest";
import { classifyGmailError, GmailScopeError } from "./errors";

describe("classifyGmailError — scope insufficient", () => {
  it("403 + ACCESS_TOKEN_SCOPE_INSUFFICIENT → GmailScopeError", async () => {
    const body = JSON.stringify({
      error: {
        code: 403,
        message: "Request had insufficient authentication scopes.",
        status: "PERMISSION_DENIED",
        errors: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }],
      },
    });
    const res = new Response(body, { status: 403 });
    const err = await classifyGmailError(res);
    expect(err).toBeInstanceOf(GmailScopeError);
    expect(err.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dashboard && pnpm vitest run src/shared/api/gmail/errors.test.ts`
Expected: FAIL — `GmailScopeError` is not exported

- [ ] **Step 3: Add GmailScopeError class + branch**

`errors.ts`의 `GmailClientError` 클래스 정의 바로 아래에 추가:

```typescript
export class GmailScopeError extends GmailError {
  constructor(message = "Gmail 쓰기 권한이 부족합니다 — 재로그인이 필요합니다") {
    super(message, 403, "ACCESS_TOKEN_SCOPE_INSUFFICIENT");
    this.name = "GmailScopeError";
  }
}
```

`classifyGmailError` 함수 안에서 `if (reason === "invalid_grant")` 줄 **위에** 추가:

```typescript
  if (status === 403 && reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT") {
    return new GmailScopeError(message);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/dashboard && pnpm vitest run src/shared/api/gmail/errors.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/shared/api/gmail/errors.ts apps/dashboard/src/shared/api/gmail/errors.test.ts
git commit -m "feat(gmail): GmailScopeError로 403 SCOPE_INSUFFICIENT 분류"
```

---

## Task 2: mime.ts — 본문 텍스트 추출 (순수 함수)

**Files:**
- Create: `apps/dashboard/src/shared/api/gmail/mime.ts`
- Test: `apps/dashboard/src/shared/api/gmail/mime.test.ts`

Gmail payload 구조: `{ mimeType, body: { data?: base64url }, parts?: Payload[], headers? }`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { extractBodyText, type GmailPayload } from "./mime";

const b64url = (s: string) =>
  Buffer.from(s, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");

describe("extractBodyText", () => {
  it("text/plain 단일 파트", () => {
    const p: GmailPayload = {
      mimeType: "text/plain",
      body: { data: b64url("안녕하세요 본문입니다") },
    };
    expect(extractBodyText(p)).toBe("안녕하세요 본문입니다");
  });

  it("multipart/alternative — text/plain 우선", () => {
    const p: GmailPayload = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64url("plain 우선") } },
        { mimeType: "text/html", body: { data: b64url("<p>html 무시</p>") } },
      ],
    };
    expect(extractBodyText(p)).toBe("plain 우선");
  });

  it("text/html only → 태그 제거", () => {
    const p: GmailPayload = {
      mimeType: "text/html",
      body: { data: b64url("<p>안녕<br>하세요</p>") },
    };
    expect(extractBodyText(p)).toContain("안녕");
    expect(extractBodyText(p)).not.toContain("<p>");
  });

  it("인용부(> ...) 절단", () => {
    const p: GmailPayload = {
      mimeType: "text/plain",
      body: { data: b64url("내 답변\n\nOn 2026 someone wrote:\n> 이전 메일") },
    };
    const out = extractBodyText(p);
    expect(out).toContain("내 답변");
    expect(out).not.toContain("이전 메일");
  });

  it("빈 payload → 빈 문자열", () => {
    expect(extractBodyText({ mimeType: "text/plain" })).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dashboard && pnpm vitest run src/shared/api/gmail/mime.test.ts`
Expected: FAIL — Cannot find module './mime'

- [ ] **Step 3: Write implementation**

`apps/dashboard/src/shared/api/gmail/mime.ts`:

```typescript
// Gmail messages.get/threads.get payload → 본문 텍스트 추출 (순수 함수).
// text/plain 우선, 없으면 HTML strip. 인용부(이전 메일 인용)는 절단.

export interface GmailPayload {
  mimeType: string;
  body?: { data?: string; size?: number };
  parts?: GmailPayload[];
  headers?: { name: string; value: string }[];
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf-8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// 인용부 절단: "On … wrote:" 또는 연속 "> " 라인 이후를 버린다.
function stripQuoted(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*On .+wrote:\s*$/i.test(line)) break;
    if (/^-----Original Message-----/i.test(line)) break;
    if (/^\s*>/.test(line)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

// payload 트리에서 첫 text/plain (없으면 첫 text/html) 데이터를 찾는다.
function findPart(
  payload: GmailPayload,
  mimeType: string,
): GmailPayload | null {
  if (payload.mimeType === mimeType && payload.body?.data) return payload;
  for (const part of payload.parts ?? []) {
    const found = findPart(part, mimeType);
    if (found) return found;
  }
  return null;
}

export function extractBodyText(payload: GmailPayload): string {
  const plain = findPart(payload, "text/plain");
  if (plain?.body?.data) {
    return stripQuoted(decodeBase64Url(plain.body.data));
  }
  const html = findPart(payload, "text/html");
  if (html?.body?.data) {
    return stripQuoted(stripHtml(decodeBase64Url(html.body.data)));
  }
  return "";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/dashboard && pnpm vitest run src/shared/api/gmail/mime.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/shared/api/gmail/mime.ts apps/dashboard/src/shared/api/gmail/mime.test.ts
git commit -m "feat(gmail): mime.ts 본문 텍스트 추출 (순수 함수)"
```

---

## Task 3: threads.ts — threads.get format=full 래퍼

**Files:**
- Create: `apps/dashboard/src/shared/api/gmail/threads.ts`
- Test: `apps/dashboard/src/shared/api/gmail/threads.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { getThread } from "./threads";

afterEach(() => vi.restoreAllMocks());

describe("getThread", () => {
  it("threads.get format=full 호출 + messages 반환", async () => {
    const fakeThread = {
      id: "t1",
      messages: [
        { id: "m1", threadId: "t1", payload: { mimeType: "text/plain", headers: [] } },
      ],
    };
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(fakeThread), { status: 200 }),
    );
    const result = await getThread("token123", "t1");
    expect(result.messages).toHaveLength(1);
    const calledUrl = spy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/threads/t1");
    expect(calledUrl).toContain("format=full");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dashboard && pnpm vitest run src/shared/api/gmail/threads.test.ts`
Expected: FAIL — Cannot find module './threads'

- [ ] **Step 3: Write implementation**

`apps/dashboard/src/shared/api/gmail/threads.ts`:

```typescript
// Gmail threads.get — format=full로 thread 전체 메시지(본문 payload 포함) 조회.
// 답장 초안 생성 시 inbound 메시지 본문·헤더 확보용. getMessage(metadata)와 별개.
import "server-only";
import { z } from "zod";
import { classifyGmailError, isRetryable, GmailError } from "./errors";
import type { GmailPayload } from "./mime";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;

const HeaderSchema = z.object({ name: z.string(), value: z.string() });

// payload는 재귀 구조라 z.lazy 없이 loose하게(unknown) 받고 mime.ts에 위임.
const ThreadMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  internalDate: z.string().optional(),
  payload: z
    .object({
      mimeType: z.string().optional().default("text/plain"),
      headers: z.array(HeaderSchema).optional(),
    })
    .passthrough()
    .optional(),
});

const ThreadSchema = z.object({
  id: z.string(),
  messages: z.array(ThreadMessageSchema).optional().default([]),
});

export interface ThreadMessage {
  id: string;
  threadId: string;
  internalDate?: string;
  payload?: GmailPayload;
}

export interface GmailThread {
  id: string;
  messages: ThreadMessage[];
}

export async function getThread(
  accessToken: string,
  gmailThreadId: string,
): Promise<GmailThread> {
  const url = `${API}/threads/${encodeURIComponent(gmailThreadId)}?format=full`;
  const response = await fetchWithRetry(url, accessToken);
  const body = (await response.json()) as unknown;
  const parsed = ThreadSchema.parse(body);
  return parsed as GmailThread;
}

async function fetchWithRetry(url: string, accessToken: string): Promise<Response> {
  let lastError: GmailError | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.ok) return response;
    const error = await classifyGmailError(response);
    if (!isRetryable(error)) throw error;
    lastError = error;
    await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
  }
  throw lastError ?? new Error("재시도 후에도 실패");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/dashboard && pnpm vitest run src/shared/api/gmail/threads.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/shared/api/gmail/threads.ts apps/dashboard/src/shared/api/gmail/threads.test.ts
git commit -m "feat(gmail): getThread (threads.get format=full) 래퍼"
```

---

## Task 4: drafts.ts — RFC822 빌드 + drafts.create (스레딩 3조건)

**Files:**
- Create: `apps/dashboard/src/shared/api/gmail/drafts.ts`
- Test: `apps/dashboard/src/shared/api/gmail/drafts.test.ts`

빌드 + 전송을 분리: `buildRfc822(params)` (순수, 테스트 쉬움) + `createDraft(token, params)` (fetch).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { buildRfc822, createDraft, type DraftParams } from "./drafts";

afterEach(() => vi.restoreAllMocks());

const base: DraftParams = {
  gmailThreadId: "t1",
  toEmail: "sender@example.com",
  subject: "회신 테스트",
  inReplyTo: "<msg-1@mail.gmail.com>",
  references: "<msg-0@mail.gmail.com> <msg-1@mail.gmail.com>",
  body: "안녕하세요, 답장 본문입니다.",
};

describe("buildRfc822", () => {
  it("Subject가 Re: 접두 + 원본 일치", () => {
    const raw = buildRfc822(base);
    // encoded-word 또는 평문 모두 Re: 포함해야 함
    expect(raw).toMatch(/Subject: .*(Re:|=\?UTF-8)/);
  });

  it("In-Reply-To / References 헤더 포함", () => {
    const raw = buildRfc822(base);
    expect(raw).toContain("In-Reply-To: <msg-1@mail.gmail.com>");
    expect(raw).toContain("References: <msg-0@mail.gmail.com> <msg-1@mail.gmail.com>");
  });

  it("한글 body → UTF-8 charset 헤더", () => {
    const raw = buildRfc822(base);
    expect(raw).toMatch(/Content-Type: text\/plain; charset="?UTF-8"?/i);
  });

  it("한글 Subject → MIME encoded-word(=?UTF-8?B?)", () => {
    const raw = buildRfc822({ ...base, subject: "한글 제목" });
    expect(raw).toContain("=?UTF-8?B?");
  });
});

describe("createDraft", () => {
  it("drafts.create에 threadId 포함한 message 전송", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "draft1", message: { id: "m2" } }), { status: 200 }),
    );
    const result = await createDraft("token123", base);
    expect(result.draftId).toBe("draft1");
    const callBody = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(callBody.message.threadId).toBe("t1");
    expect(typeof callBody.message.raw).toBe("string");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dashboard && pnpm vitest run src/shared/api/gmail/drafts.test.ts`
Expected: FAIL — Cannot find module './drafts'

- [ ] **Step 3: Write implementation**

`apps/dashboard/src/shared/api/gmail/drafts.ts`:

```typescript
// Gmail drafts.create — 기존 스레드에 답장 초안 추가.
// 스레딩 3조건 (https://developers.google.com/gmail/api/guides/threads):
//   ① message.threadId 명시  ② In-Reply-To/References 헤더  ③ Subject 일치(Re:)
// 한글 안전: Subject는 MIME encoded-word, body는 UTF-8 charset.
import "server-only";
import { z } from "zod";
import { classifyGmailError } from "./errors";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface DraftParams {
  gmailThreadId: string;
  toEmail: string;
  /** 원본 Subject (이미 Re: 포함돼 있으면 중복 안 붙임). */
  subject: string;
  /** 답장 대상 메시지의 Message-ID 헤더. */
  inReplyTo: string;
  /** 기존 References 체인 + inReplyTo. */
  references: string;
  /** 사용자가 편집한 답장 본문. */
  body: string;
}

const CreateDraftResponseSchema = z.object({
  id: z.string(),
  message: z.object({ id: z.string() }).passthrough().optional(),
});

export interface CreateDraftResult {
  draftId: string;
}

function encodeSubject(subject: string): string {
  const re = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
  // ASCII만 있으면 그대로, 비ASCII 포함 시 encoded-word.
  if (/^[\x00-\x7F]*$/.test(re)) return re;
  const b64 = Buffer.from(re, "utf-8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

function toBase64Url(raw: string): string {
  return Buffer.from(raw, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function buildRfc822(params: DraftParams): string {
  const headers = [
    `To: ${params.toEmail}`,
    `Subject: ${encodeSubject(params.subject)}`,
    `In-Reply-To: ${params.inReplyTo}`,
    `References: ${params.references}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "MIME-Version: 1.0",
  ];
  return headers.join("\r\n") + "\r\n\r\n" + params.body;
}

export async function createDraft(
  accessToken: string,
  params: DraftParams,
): Promise<CreateDraftResult> {
  const raw = toBase64Url(buildRfc822(params));
  const response = await fetch(`${API}/drafts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: { threadId: params.gmailThreadId, raw },
    }),
  });
  if (!response.ok) {
    throw await classifyGmailError(response);
  }
  const parsed = CreateDraftResponseSchema.parse(await response.json());
  return { draftId: parsed.id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/dashboard && pnpm vitest run src/shared/api/gmail/drafts.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/shared/api/gmail/drafts.ts apps/dashboard/src/shared/api/gmail/drafts.test.ts
git commit -m "feat(gmail): drafts.create — RFC822 빌드 + 스레딩 3조건 + 한글 안전"
```

---

## Task 5: gmail/index.ts barrel에 신규 export 추가

**Files:**
- Modify: `apps/dashboard/src/shared/api/gmail/index.ts`

- [ ] **Step 1: Add exports**

`index.ts` 끝에 추가:

```typescript
export { getThread } from "./threads";
export type { GmailThread, ThreadMessage } from "./threads";
export { extractBodyText } from "./mime";
export type { GmailPayload } from "./mime";
export { createDraft, buildRfc822 } from "./drafts";
export type { DraftParams, CreateDraftResult } from "./drafts";
export { GmailScopeError } from "./errors";
```

- [ ] **Step 2: Verify typecheck**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS (no errors)

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/shared/api/gmail/index.ts
git commit -m "feat(gmail): barrel에 threads/mime/drafts/scope export 추가"
```

---

## Task 6: draft-reply.ts — LLM 초안 생성

**Files:**
- Create: `apps/dashboard/src/shared/lib/llm/draft-reply.ts`
- Test: `apps/dashboard/src/shared/lib/llm/draft-reply.test.ts`

classify-thread.ts 패턴 미러. `analyzeStructured` mock으로 테스트.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("@krdn/llm-gateway/gateway", () => ({
  analyzeStructured: vi.fn(),
}));

import { analyzeStructured } from "@krdn/llm-gateway/gateway";
import { draftReply } from "./draft-reply";

const mockAnalyze = vi.mocked(analyzeStructured);

describe("draftReply", () => {
  it("정상 → needs-draft + body 반환", async () => {
    mockAnalyze.mockResolvedValueOnce({
      object: { body: "안녕하세요, 검토 후 회신드리겠습니다." },
    } as never);
    const result = await draftReply({
      fromEmail: "a@b.com",
      subject: "프로젝트 참여 가능 여부",
      bodyText: "참여 가능한지 알려주세요.",
      severity: "med",
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.body).toContain("회신");
  });

  it("LLM 에러 → llm-unavailable", async () => {
    mockAnalyze.mockRejectedValueOnce(new Error("gateway down"));
    const result = await draftReply({
      fromEmail: "a@b.com",
      subject: "x",
      bodyText: "y",
      severity: "low",
    });
    expect(result.kind).toBe("llm-unavailable");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dashboard && pnpm vitest run src/shared/lib/llm/draft-reply.test.ts`
Expected: FAIL — Cannot find module './draft-reply'

- [ ] **Step 3: Write implementation**

`apps/dashboard/src/shared/lib/llm/draft-reply.ts`:

```typescript
// 답장 초안 생성 LLM 유틸 — classify-thread.ts 패턴 미러.
// 광고/공지/답장 불필요 메일이면 짧은 정중 거절 또는 빈 초안을 생성한다.
import "server-only";
import { z } from "zod";
import { analyzeStructured } from "@krdn/llm-gateway/gateway";
import { HAIKU_MODEL, gatewayDefaults } from "./anthropic";

const MAX_BODY_BYTES = 5 * 1024;

export interface DraftReplyInput {
  fromEmail: string;
  fromName?: string;
  subject: string;
  /** 원본 메일 본문 (mime.ts 추출). 빈 문자열이면 snippet 폴백을 호출자가 넣음. */
  bodyText: string;
  severity: "high" | "med" | "low";
}

const ResponseSchema = z.object({
  body: z.string().min(1).max(2000),
});

export type DraftReplyResult =
  | { kind: "ok"; body: string }
  | { kind: "llm-unavailable"; error: string };

const SYSTEM_PROMPT = `당신은 사용자를 대신해 이메일 답장 초안을 작성합니다.
원본 메일의 맥락(제안/질문/요청)을 읽고 적절한 톤으로 한국어 답장을 씁니다.

규칙:
- 받은 메일의 핵심 요청에 직접 응답하는 본문을 작성.
- 메일 성격에 맞는 톤 자동 선택 (정중·간결).
- 광고/공지/마케팅 등 답장이 불필요한 메일이면 짧은 정중한 거절 또는 수신 거부 의사를 1~2문장으로.
- 인사말 + 본문 + 맺음말 구조. 서명은 넣지 않음.
- 응답은 답장 본문 텍스트만. 메타 설명 금지.

JSON: {"body": "답장 본문 전체"}`;

export async function draftReply(
  input: DraftReplyInput,
): Promise<DraftReplyResult> {
  const truncated = truncateBytes(input.bodyText, MAX_BODY_BYTES);

  const userPrompt = [
    `From: ${input.fromName ?? input.fromEmail} <${input.fromEmail}>`,
    `Subject: ${input.subject}`,
    `긴급도: ${input.severity}`,
    "",
    "원본 본문:",
    truncated || "(본문 없음 — 제목 기반으로 작성)",
    "",
    "위 메일에 대한 답장 본문을 JSON으로 작성하세요.",
  ].join("\n");

  try {
    const { object } = await analyzeStructured(userPrompt, ResponseSchema, {
      ...gatewayDefaults,
      model: HAIKU_MODEL,
      systemPrompt: SYSTEM_PROMPT,
      maxOutputTokens: 1000,
    });
    return { kind: "ok", body: object.body };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return { kind: "llm-unavailable", error: message };
  }
}

function truncateBytes(input: string, maxBytes: number): string {
  const buffer = Buffer.from(input, "utf-8");
  if (buffer.byteLength <= maxBytes) return input;
  return buffer.subarray(0, maxBytes).toString("utf-8") + "…";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/dashboard && pnpm vitest run src/shared/lib/llm/draft-reply.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/shared/lib/llm/draft-reply.ts apps/dashboard/src/shared/lib/llm/draft-reply.test.ts
git commit -m "feat(llm): draftReply — 답장 초안 생성 (5KB 절단, 광고 거절 처리)"
```

---

## Task 7: generateReplyDraft Server Action

**Files:**
- Create: `apps/dashboard/src/features/email-reply/api/generateReplyDraft.ts`

본문 fetch → inbound 메시지 선택 → LLM. DB 조회로 gmailThreadId·발신자·subject 확보.

- [ ] **Step 1: Write implementation**

`apps/dashboard/src/features/email-reply/api/generateReplyDraft.ts`:

```typescript
// "답장하기" 첫 클릭 → 본문 fetch + LLM 초안 생성.
// thread 전체를 한 번에 받아 inbound 메시지(상대 발신)를 선택, 본문·헤더 확보.
// DB 무저장 — 매 호출 fresh 생성.
"use server";

import "server-only";
import { and, eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { emailThreads, replyNeeded, users } from "@/shared/lib/db/schema";
import {
  getValidAccessToken,
  getThread,
  extractBodyText,
  findHeader,
  GmailScopeError,
  type ThreadMessage,
} from "@/shared/api/gmail";
import { draftReply } from "@/shared/lib/llm/draft-reply";

export type GenerateReplyResult =
  | {
      kind: "ok";
      body: string;
      meta: {
        gmailThreadId: string;
        toEmail: string;
        subject: string;
        inReplyTo: string;
        references: string;
      };
    }
  | { kind: "fetch-failed" }
  | { kind: "llm-unavailable" }
  | { kind: "scope-required" };

export async function generateReplyDraft(
  threadId: string,
): Promise<GenerateReplyResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const userId = session.user.id;

  // 1. 소유권 확인 + gmailThreadId·snippet·발신자 확보.
  const rows = await db
    .select({
      gmailThreadId: emailThreads.gmailThreadId,
      subject: emailThreads.subject,
      snippet: emailThreads.snippet,
      fromEmail: emailThreads.lastSenderEmail,
      fromName: emailThreads.lastSenderName,
      severity: replyNeeded.severity,
      ownerEmail: users.email,
    })
    .from(replyNeeded)
    .innerJoin(emailThreads, eq(replyNeeded.threadId, emailThreads.id))
    .innerJoin(users, eq(replyNeeded.userId, users.id))
    .where(and(eq(replyNeeded.threadId, threadId), eq(replyNeeded.userId, userId)))
    .limit(1);

  if (rows.length === 0) throw new Error("Thread not found");
  const row = rows[0];

  // 2. access token.
  const { accessToken } = await getValidAccessToken(userId);

  // 3. thread 전체 fetch + inbound 메시지 선택.
  let inbound: ThreadMessage | null = null;
  let bodyText = "";
  try {
    const thread = await getThread(accessToken, row.gmailThreadId);
    inbound = pickInbound(thread.messages, row.ownerEmail);
    if (inbound?.payload) bodyText = extractBodyText(inbound.payload);
  } catch (error) {
    if (error instanceof GmailScopeError) return { kind: "scope-required" };
    // fetch 실패 → snippet 폴백으로 진행 (초안은 생성).
    bodyText = "";
  }

  // 본문 비면 snippet 폴백.
  if (!bodyText) bodyText = row.snippet ?? "";

  // 4. 답장 헤더 메타 구성.
  const headers = inbound?.payload?.headers;
  const messageId = findHeader(headers, "Message-ID") ?? "";
  const existingRefs = findHeader(headers, "References") ?? "";
  const replyTo = findHeader(headers, "Reply-To");
  const fromHeader = findHeader(headers, "From");
  const toEmail =
    replyTo ?? fromHeader ?? row.fromEmail ?? "";

  // 5. LLM 초안.
  const result = await draftReply({
    fromEmail: row.fromEmail ?? "",
    fromName: row.fromName ?? undefined,
    subject: row.subject ?? "",
    bodyText,
    severity: row.severity as "high" | "med" | "low",
  });

  if (result.kind === "llm-unavailable") return { kind: "llm-unavailable" };

  return {
    kind: "ok",
    body: result.body,
    meta: {
      gmailThreadId: row.gmailThreadId,
      toEmail: extractEmail(toEmail) || (row.fromEmail ?? ""),
      subject: row.subject ?? "",
      inReplyTo: messageId,
      references: existingRefs ? `${existingRefs} ${messageId}`.trim() : messageId,
    },
  };
}

// From이 ownerEmail이 아닌 마지막 메시지 = 상대가 보낸 가장 최근 메일.
// 전부 본인 발신이면 마지막 메시지로 폴백.
function pickInbound(
  messages: ThreadMessage[],
  ownerEmail: string,
): ThreadMessage | null {
  if (messages.length === 0) return null;
  const owner = ownerEmail.toLowerCase();
  for (let i = messages.length - 1; i >= 0; i--) {
    const from = findHeader(messages[i].payload?.headers, "From") ?? "";
    if (!extractEmail(from).toLowerCase().includes(owner)) return messages[i];
  }
  return messages[messages.length - 1];
}

// "이름 <a@b.com>" → "a@b.com". 꺾쇠 없으면 원문 trim.
function extractEmail(headerValue: string): string {
  const m = headerValue.match(/<([^>]+)>/);
  return (m ? m[1] : headerValue).trim();
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/features/email-reply/api/generateReplyDraft.ts
git commit -m "feat(email-reply): generateReplyDraft — thread fetch + inbound 선택 + LLM 초안"
```

---

## Task 8: saveReplyDraft Server Action

**Files:**
- Create: `apps/dashboard/src/features/email-reply/api/saveReplyDraft.ts`

- [ ] **Step 1: Write implementation**

`apps/dashboard/src/features/email-reply/api/saveReplyDraft.ts`:

```typescript
// 편집된 답장 본문 → Gmail 초안 저장. DB 무저장.
"use server";

import "server-only";
import { and, eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { emailThreads, replyNeeded } from "@/shared/lib/db/schema";
import {
  getValidAccessToken,
  createDraft,
  GmailScopeError,
} from "@/shared/api/gmail";

export interface SaveDraftMeta {
  gmailThreadId: string;
  toEmail: string;
  subject: string;
  inReplyTo: string;
  references: string;
}

export type SaveReplyResult =
  | { kind: "ok"; draftId: string }
  | { kind: "scope-required" }
  | { kind: "save-failed" };

export async function saveReplyDraft(
  threadId: string,
  editedBody: string,
  meta: SaveDraftMeta,
): Promise<SaveReplyResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const userId = session.user.id;

  // 소유권 재확인 (meta는 클라이언트에서 왔으므로 threadId 기준으로 검증).
  const owned = await db
    .select({ gmailThreadId: emailThreads.gmailThreadId })
    .from(replyNeeded)
    .innerJoin(emailThreads, eq(replyNeeded.threadId, emailThreads.id))
    .where(and(eq(replyNeeded.threadId, threadId), eq(replyNeeded.userId, userId)))
    .limit(1);

  if (owned.length === 0) throw new Error("Thread not found");
  // gmailThreadId는 DB 값을 신뢰 (meta 위변조 방지).
  const gmailThreadId = owned[0].gmailThreadId;

  const { accessToken } = await getValidAccessToken(userId);

  try {
    const result = await createDraft(accessToken, {
      gmailThreadId,
      toEmail: meta.toEmail,
      subject: meta.subject,
      inReplyTo: meta.inReplyTo,
      references: meta.references,
      body: editedBody,
    });
    return { kind: "ok", draftId: result.draftId };
  } catch (error) {
    if (error instanceof GmailScopeError) return { kind: "scope-required" };
    return { kind: "save-failed" };
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/features/email-reply/api/saveReplyDraft.ts
git commit -m "feat(email-reply): saveReplyDraft — Gmail 초안 저장 (소유권 재확인)"
```

---

## Task 9: email-reply barrel (server + client seam)

**Files:**
- Create: `apps/dashboard/src/features/email-reply/index.ts`
- Create: `apps/dashboard/src/features/email-reply/client.ts`

Gotcha #7: server-only 함수와 Server Action을 분리한다. 여기선 둘 다 Server Action이지만, client 컴포넌트가 import할 진입점을 `client.ts`로 명확히 둔다.

- [ ] **Step 1: Write index.ts (server entrypoint)**

```typescript
// features/email-reply — server entrypoint.
// Server Action들은 client.ts로도 노출 (client 컴포넌트 import용).
import "server-only";

export { generateReplyDraft } from "./api/generateReplyDraft";
export type { GenerateReplyResult } from "./api/generateReplyDraft";
export { saveReplyDraft } from "./api/saveReplyDraft";
export type { SaveReplyResult, SaveDraftMeta } from "./api/saveReplyDraft";
```

- [ ] **Step 2: Write client.ts (Server Action re-export for client components)**

```typescript
// features/email-reply — client-safe entrypoint.
// "use client" 컴포넌트는 이 모듈로만 Server Action을 import.
// (server-only 함수가 같은 barrel에 섞이지 않게 분리 — Gotcha #7)
export { generateReplyDraft } from "./api/generateReplyDraft";
export type { GenerateReplyResult } from "./api/generateReplyDraft";
export { saveReplyDraft } from "./api/saveReplyDraft";
export type { SaveReplyResult, SaveDraftMeta } from "./api/saveReplyDraft";
```

- [ ] **Step 3: Verify typecheck**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/features/email-reply/index.ts apps/dashboard/src/features/email-reply/client.ts
git commit -m "feat(email-reply): server/client barrel seam (Gotcha #7)"
```

---

## Task 10: ReplyComposer 인라인 편집기 UI

**Files:**
- Create: `apps/dashboard/src/widgets/email-digest/ui/ReplyComposer.tsx`

- [ ] **Step 1: Write implementation**

`apps/dashboard/src/widgets/email-digest/ui/ReplyComposer.tsx`:

```typescript
// 답장 초안 인라인 편집기 — ReplyCard 펼침 영역.
// 첫 마운트 시 generateReplyDraft 호출 → textarea로 수정 → saveReplyDraft.
// setState는 이벤트 핸들러/콜백에서만 (React 19 purity — 메모리 룰).
"use client";

import { useEffect, useState, useTransition } from "react";
import {
  generateReplyDraft,
  saveReplyDraft,
  type SaveDraftMeta,
} from "@/features/email-reply/client";

interface ReplyComposerProps {
  threadId: string;
  onSaved: () => void;
}

type Status =
  | { phase: "loading" }
  | { phase: "editing"; meta: SaveDraftMeta }
  | { phase: "error"; message: string }
  | { phase: "saved"; gmailThreadId: string };

export function ReplyComposer({ threadId, onSaved }: ReplyComposerProps) {
  const [status, setStatus] = useState<Status>({ phase: "loading" });
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();

  // 최초 1회 초안 생성. (effect에서 동기 setState 금지 — 콜백 내부에서만)
  useEffect(() => {
    let cancelled = false;
    generateReplyDraft(threadId).then(
      (result) => {
        if (cancelled) return;
        if (result.kind === "ok") {
          setBody(result.body);
          setStatus({ phase: "editing", meta: result.meta });
        } else if (result.kind === "scope-required") {
          setStatus({ phase: "error", message: "Gmail 쓰기 권한이 없습니다. 재로그인 해주세요." });
        } else if (result.kind === "llm-unavailable") {
          setStatus({ phase: "error", message: "초안 생성에 실패했습니다. 다시 시도하세요." });
        } else {
          setStatus({ phase: "error", message: "원본 메일을 불러올 수 없습니다." });
        }
      },
      () => {
        if (!cancelled) setStatus({ phase: "error", message: "초안 생성 중 오류가 발생했습니다." });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const handleRegenerate = () => {
    setStatus({ phase: "loading" });
    generateReplyDraft(threadId).then(
      (result) => {
        if (result.kind === "ok") {
          setBody(result.body);
          setStatus({ phase: "editing", meta: result.meta });
        } else {
          setStatus({ phase: "error", message: "다시 생성에 실패했습니다." });
        }
      },
      () => setStatus({ phase: "error", message: "다시 생성 중 오류." }),
    );
  };

  const handleSave = (meta: SaveDraftMeta) => {
    startTransition(() => {
      saveReplyDraft(threadId, body, meta).then(
        (result) => {
          if (result.kind === "ok") {
            setStatus({ phase: "saved", gmailThreadId: meta.gmailThreadId });
          } else if (result.kind === "scope-required") {
            setStatus({ phase: "error", message: "Gmail 쓰기 권한이 없습니다. 재로그인 해주세요." });
          } else {
            setStatus({ phase: "error", message: "초안 저장에 실패했습니다." });
          }
        },
        () => setStatus({ phase: "error", message: "저장 중 오류가 발생했습니다." }),
      );
    });
  };

  if (status.phase === "loading") {
    return (
      <div className="mt-3 border-t border-dashed border-[var(--color-hairline)] pt-3 text-xs text-[var(--color-text-muted)]">
        ✦ AI 초안 생성 중…
      </div>
    );
  }

  if (status.phase === "saved") {
    return (
      <div className="mt-3 border-t border-dashed border-[var(--color-hairline)] pt-3 text-xs">
        <span className="font-medium text-[var(--color-text)]">✓ Gmail 초안함에 저장됐습니다.</span>{" "}
        <a
          href={`https://mail.google.com/mail/u/0/#drafts`}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--color-accent)] underline"
        >
          Gmail에서 열기 ↗
        </a>
      </div>
    );
  }

  if (status.phase === "error") {
    return (
      <div className="mt-3 border-t border-dashed border-[var(--color-hairline)] pt-3">
        <p className="text-xs font-medium text-[var(--color-severity-high)]" role="status">
          {status.message}
        </p>
        <button
          type="button"
          onClick={handleRegenerate}
          className="mt-2 rounded-md border border-[var(--color-hairline)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
        >
          다시 시도
        </button>
      </div>
    );
  }

  // editing
  return (
    <div className="mt-3 border-t border-dashed border-[var(--color-hairline)] pt-3">
      <div className="mb-1.5 text-[11px] text-[var(--color-text-muted)]">✦ AI 초안 · 수정 가능</div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={6}
        className="w-full resize-y rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={isPending || body.trim().length === 0}
          onClick={() => handleSave(status.meta)}
          className="rounded-md bg-[var(--color-text)] px-3 py-1.5 text-xs font-medium text-[var(--color-surface)] transition-colors hover:bg-[oklch(15%_0.01_264)] disabled:opacity-50"
        >
          Gmail 초안 저장
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={handleRegenerate}
          className="rounded-md border border-[var(--color-hairline)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
        >
          다시 생성
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={onSaved}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
        >
          취소
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/widgets/email-digest/ui/ReplyComposer.tsx
git commit -m "feat(email-digest): ReplyComposer 인라인 답장 편집기"
```

---

## Task 11: ReplyCard에 토글 + composer 통합

**Files:**
- Modify: `apps/dashboard/src/widgets/email-digest/ui/ReplyCard.tsx`

기존 "답장하기 ↗" `<a>`(line 111-118)를 토글 버튼으로 바꾸고, 펼침 시 ReplyComposer 렌더.

- [ ] **Step 1: Add import + state**

`ReplyCard.tsx` 상단 import에 추가:

```typescript
import { ReplyComposer } from "./ReplyComposer";
```

`ReplyCard` 함수 본문의 기존 useState 아래에 추가:

```typescript
  const [isComposing, setIsComposing] = useState(false);
```

- [ ] **Step 2: Replace 답장하기 link with toggle button**

기존 `<a href={...}>답장하기 ↗</a>` 블록(line 111-118)을 교체:

```typescript
        <button
          type="button"
          onClick={() => setIsComposing((v) => !v)}
          aria-expanded={isComposing}
          className="rounded-md bg-[var(--color-text)] px-3 py-1.5 text-xs font-medium text-[var(--color-surface)] transition-colors hover:bg-[oklch(15%_0.01_264)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          답장하기 {isComposing ? "▴" : "▾"}
        </button>
```

- [ ] **Step 3: Render composer when expanded**

`<div className="min-w-0">` 블록 안, `error` 표시 직후(닫는 `</div>` 앞)에 추가:

```typescript
        {isComposing ? (
          <ReplyComposer threadId={item.threadId} onSaved={() => setIsComposing(false)} />
        ) : null}
```

- [ ] **Step 4: Verify typecheck + lint + build**

Run:
```bash
cd apps/dashboard && pnpm typecheck && pnpm lint
```
Expected: PASS

- [ ] **Step 5: Build verification (server/client seam — Gotcha #7)**

Run: `cd apps/dashboard && pnpm build`
Expected: 빌드 성공. `Module not found: tls/net/perf_hooks` 없음.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/widgets/email-digest/ui/ReplyCard.tsx
git commit -m "feat(email-digest): ReplyCard 답장하기 토글 + ReplyComposer 통합"
```

---

## Task 12: 전체 검증

- [ ] **Step 1: 전체 테스트**

Run:
```bash
cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/shared/api/gmail src/shared/lib/llm/draft-reply.test.ts
```
Expected: 신규 테스트 전부 PASS (errors/mime/threads/drafts/draft-reply)

- [ ] **Step 2: typecheck + lint + build 최종**

Run:
```bash
cd apps/dashboard && pnpm typecheck && pnpm lint && pnpm build
```
Expected: 모두 PASS

- [ ] **Step 3: 수동 확인 (선택, dev 서버)**

`pnpm dev` → http://localhost:3020 → "오늘 답장 필요" 카드 → "답장하기 ▾" 클릭 →
초안 생성 확인 → 본문 수정 → "Gmail 초안 저장" → Gmail 초안함 확인.

---

## 비범위 재확인 (이 계획에 없음)

- 대시보드 직접 발송, 톤 선택 버튼, DB 초안 영속화, rate limit, 첨부파일 — 설계 §8 참조.
