# Email Classification Eval (v0.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이메일 분류기(답장 필요 / 중요)의 정확도 회귀를 잡는 2계층 eval 시스템을 구현한다.

**Architecture:** Layer 1(매 PR, vitest, LLM 없음) = deterministic recall + severity exact-match. Layer 2(수동/nightly, tsx 스크립트, 실제 Haiku) = precision/recall/F1 리포트. golden set은 합성 fixture(레포 커밋). 임계치는 구현 후 베이스라인 측정으로 확정.

**Tech Stack:** TypeScript, vitest 4, tsx, Zod, `@krdn/llm-gateway`, 기존 `classifyDeterministic`/`isMailingList`/`classifyWithLLM`/`classifyImportantWithLlm`.

설계 문서: `docs/superpowers/specs/2026-06-17-email-classification-eval-design.md`

---

## File Structure

| 파일 | 책임 |
|---|---|
| `apps/dashboard/tests/eval/types.ts` | fixture·결과 타입 + Zod 스키마 (순수) |
| `apps/dashboard/tests/eval/scorer.ts` | confusion matrix → precision/recall/f1 (순수 함수) |
| `apps/dashboard/tests/eval/scorer.test.ts` | scorer 단위 테스트 |
| `apps/dashboard/tests/eval/fixtures/reply-needed.json` | 답장 트랙 golden (A/B/C 케이스) |
| `apps/dashboard/tests/eval/fixtures/important.json` | 중요 트랙 golden (카테고리 + none/mailing-list) |
| `apps/dashboard/tests/eval/fixtures.test.ts` | 모든 fixture가 Zod 스키마 통과 |
| `apps/dashboard/tests/eval/thresholds.json` | 임계치 (placeholder → 베이스라인 후) |
| `apps/dashboard/tests/eval/reply-deterministic.eval.test.ts` | Layer 1: deterministic recall + 스냅샷 |
| `apps/dashboard/tests/eval/important-mailinglist.eval.test.ts` | Layer 1: mailing-list 컷 회귀 |
| `apps/dashboard/tests/eval/run-llm-eval.ts` | Layer 2: 실제 Haiku 호출 → 리포트 |
| `apps/dashboard/package.json` | `eval:llm` 스크립트 추가 |
| `.gitignore` | `tests/eval/reports/` 무시 |

**참고 — 기존 시그니처 (계획서 코드가 의존):**
- `ThreadInput` (`src/entities/email/model/types.ts`): `threadId, lastSenderEmail, lastSenderName?, subject, snippet, receivedAt: Date, ownerEmail, lastSenderIsOwner` 필수.
- `MailingListSignals` (`src/shared/api/gmail/headers.ts`): `hasListUnsubscribe, hasListId, precedence: string|null, fromHeader: string|null`.
- `ImportantInput`: `subject, fromName: string|null, fromEmail, snippet, receivedAtKst`.
- `classifyDeterministic(input: ThreadInput): ClassificationResult | null`.
- `isMailingList(signals: MailingListSignals, snippet: string): boolean`.
- `classifyWithLLM(input: LlmClassifyInput): Promise<LlmClassifyResult>` — `LlmClassifyInput = {fromEmail, fromName?, subject, snippet}`. 결과 kind: `needs-reply | no-reply | llm-unavailable`.
- `classifyImportantWithLlm(input: ImportantInput): Promise<LlmImportantClassification | null>`.
- vitest `include`가 `tests/**/*.test.ts` 를 잡음 → eval 테스트는 `.eval.test.ts` 로 끝나야 인식됨.

---

## Task 1: eval 타입 + Zod 스키마

**Files:**
- Create: `apps/dashboard/tests/eval/types.ts`

- [ ] **Step 1: 타입 + 스키마 작성**

```typescript
// eval fixture·결과 타입 — 순수 (LLM·DB 의존 없음).
// fixture는 합성 데이터만 (실제 개인 메일 X). spec 2026-06-17 §4.
import { z } from "zod";

// ── 답장 트랙 fixture ──────────────────────────────────────────────
// input은 ThreadInput과 구조 호환 (receivedAt은 fixture에서 ISO 문자열 → 로드 시 Date).
export const ReplyFixtureSchema = z.object({
  id: z.string().min(1),
  /** 케이스 군 — A: 키워드+필요, B: 암시적 필요, C: 키워드 있으나 junk. */
  kind: z.enum(["A", "B", "C"]),
  input: z.object({
    subject: z.string(),
    snippet: z.string(),
    lastSenderEmail: z.string(),
    lastSenderName: z.string().optional(),
    ownerEmail: z.string(),
    lastSenderIsOwner: z.boolean(),
  }),
  expect: z.object({
    needsReply: z.boolean(),
    severity: z.enum(["high", "med", "low"]).optional(),
  }),
});
export type ReplyFixture = z.infer<typeof ReplyFixtureSchema>;

// ── 중요 트랙 fixture ──────────────────────────────────────────────
export const ImportantFixtureSchema = z.object({
  id: z.string().min(1),
  input: z.object({
    subject: z.string(),
    fromName: z.string().nullable(),
    fromEmail: z.string(),
    snippet: z.string(),
    receivedAtKst: z.string(),
  }),
  signals: z.object({
    hasListUnsubscribe: z.boolean(),
    hasListId: z.boolean(),
    precedence: z.string().nullable(),
    fromHeader: z.string().nullable(),
  }),
  expect: z.object({
    isMailingList: z.boolean(),
    category: z.enum(["money", "security", "schedule", "notice", "none"]).optional(),
    importance: z.enum(["high", "med"]).optional(),
  }),
});
export type ImportantFixture = z.infer<typeof ImportantFixtureSchema>;

export const ReplyFixtureArraySchema = z.array(ReplyFixtureSchema);
export const ImportantFixtureArraySchema = z.array(ImportantFixtureSchema);

// ── thresholds.json 스키마 (null = 베이스라인 미확정) ──────────────
export const ThresholdsSchema = z.object({
  replyDeterministic: z.object({ recall: z.number().nullable() }),
  replyLlm: z.object({
    precision: z.number().nullable(),
    recall: z.number().nullable(),
  }),
  importantLlm: z.object({
    categoryMacroF1: z.number().nullable(),
    importanceAccuracy: z.number().nullable(),
  }),
});
export type Thresholds = z.infer<typeof ThresholdsSchema>;
```

- [ ] **Step 2: 타입 체크로 검증**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS (새 파일에 타입 오류 없음)

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/tests/eval/types.ts
git commit -m "feat(email-eval): eval fixture·결과 타입 + Zod 스키마"
```

---

## Task 2: scorer 순수 함수 (TDD)

**Files:**
- Create: `apps/dashboard/tests/eval/scorer.ts`
- Test: `apps/dashboard/tests/eval/scorer.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
import { describe, it, expect } from "vitest";
import { binaryMetrics, macroF1 } from "./scorer";

describe("binaryMetrics", () => {
  it("완벽 분류 → precision=recall=f1=1", () => {
    // 3 TP, 0 FP, 0 FN
    const m = binaryMetrics([
      { predicted: true, expected: true },
      { predicted: true, expected: true },
      { predicted: false, expected: false },
    ]);
    expect(m.tp).toBe(2);
    expect(m.tn).toBe(1);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.f1).toBe(1);
  });

  it("FN 1건 → recall 하락, precision 유지", () => {
    // 1 TP, 0 FP, 1 FN → precision=1, recall=0.5
    const m = binaryMetrics([
      { predicted: true, expected: true },
      { predicted: false, expected: true },
    ]);
    expect(m.tp).toBe(1);
    expect(m.fn).toBe(1);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(0.5);
    expect(m.f1).toBeCloseTo(0.6667, 3);
  });

  it("양성 예측 0건 → precision=0 (0 나눗셈 방어)", () => {
    const m = binaryMetrics([{ predicted: false, expected: true }]);
    expect(m.precision).toBe(0);
    expect(m.recall).toBe(0);
    expect(m.f1).toBe(0);
  });
});

describe("macroF1", () => {
  it("2-class 완벽 분류 → macroF1=1", () => {
    const f1 = macroF1(
      [
        { predicted: "money", expected: "money" },
        { predicted: "security", expected: "security" },
      ],
      ["money", "security", "schedule", "notice", "none"],
    );
    expect(f1).toBe(1);
  });

  it("한 클래스 전부 오분류 → macroF1 < 1", () => {
    const f1 = macroF1(
      [
        { predicted: "money", expected: "money" },
        { predicted: "money", expected: "security" }, // security 오분류
      ],
      ["money", "security", "schedule", "notice", "none"],
    );
    expect(f1).toBeLessThan(1);
    expect(f1).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/dashboard && pnpm vitest run tests/eval/scorer.test.ts`
Expected: FAIL — "Cannot find module './scorer'" 또는 "binaryMetrics is not a function"

- [ ] **Step 3: scorer 구현**

```typescript
// confusion matrix → precision/recall/f1. 순수 함수 (LLM·DB 의존 없음).
// spec 2026-06-17 §5.

export interface BinaryMetrics {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface BinaryCase {
  predicted: boolean;
  expected: boolean;
}

export function binaryMetrics(cases: BinaryCase[]): BinaryMetrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const c of cases) {
    if (c.predicted && c.expected) tp++;
    else if (c.predicted && !c.expected) fp++;
    else if (!c.predicted && c.expected) fn++;
    else tn++;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, tn, precision, recall, f1 };
}

export interface MultiClassCase<T extends string> {
  predicted: T;
  expected: T;
}

/** macro-averaged F1 — 각 클래스를 one-vs-rest 이진으로 보고 F1 평균. */
export function macroF1<T extends string>(
  cases: MultiClassCase<T>[],
  classes: readonly T[],
): number {
  if (cases.length === 0) return 0;
  const perClassF1 = classes.map((cls) => {
    const binary = cases.map((c) => ({
      predicted: c.predicted === cls,
      expected: c.expected === cls,
    }));
    return binaryMetrics(binary).f1;
  });
  return perClassF1.reduce((a, b) => a + b, 0) / classes.length;
}

/** exact-match accuracy — predicted === expected 비율. */
export function accuracy<T>(cases: { predicted: T; expected: T }[]): number {
  if (cases.length === 0) return 0;
  const correct = cases.filter((c) => c.predicted === c.expected).length;
  return correct / cases.length;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd apps/dashboard && pnpm vitest run tests/eval/scorer.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/tests/eval/scorer.ts apps/dashboard/tests/eval/scorer.test.ts
git commit -m "feat(email-eval): scorer 순수 함수 (binaryMetrics/macroF1/accuracy) + 테스트"
```

---

## Task 3: golden fixture 작성 + Zod 검증 테스트

**Files:**
- Create: `apps/dashboard/tests/eval/fixtures/reply-needed.json`
- Create: `apps/dashboard/tests/eval/fixtures/important.json`
- Test: `apps/dashboard/tests/eval/fixtures.test.ts`

> **규모 안내:** 아래는 케이스 군별 대표 샘플(답장 9건, 중요 9건)이다. 구현자는 각 군을
> 균형있게 ~25건까지 확장한다. **로그로 최종 건수를 남길 것** (silent 축소 금지). 확장 시
> 군 비율을 유지: 답장 A:B:C ≈ 1:1:1, 중요 = (실분류 카테고리 4종 골고루) + (mailing-list 컷) + (none).

- [ ] **Step 1: reply-needed.json 작성**

```json
[
  { "id": "r-A-deadline-ko", "kind": "A",
    "input": { "subject": "내일까지 회신 부탁드립니다", "snippet": "계약서 검토 후 의견 주세요",
      "lastSenderEmail": "client@acme.com", "lastSenderName": "김대표", "ownerEmail": "me@x.com",
      "lastSenderIsOwner": false },
    "expect": { "needsReply": true, "severity": "high" } },
  { "id": "r-A-urgent-ko", "kind": "A",
    "input": { "subject": "긴급: 승인 필요", "snippet": "오늘 내로 승인 부탁드립니다",
      "lastSenderEmail": "boss@acme.com", "ownerEmail": "me@x.com", "lastSenderIsOwner": false },
    "expect": { "needsReply": true, "severity": "high" } },
  { "id": "r-A-question-ko", "kind": "A",
    "input": { "subject": "일정 가능하신가요?", "snippet": "다음 주 회의 언제가 좋으세요?",
      "lastSenderEmail": "peer@acme.com", "ownerEmail": "me@x.com", "lastSenderIsOwner": false },
    "expect": { "needsReply": true, "severity": "med" } },
  { "id": "r-A-deadline-en", "kind": "A",
    "input": { "subject": "Please reply by EOD", "snippet": "Need the deck by end of day.",
      "lastSenderEmail": "client@global.com", "ownerEmail": "me@x.com", "lastSenderIsOwner": false },
    "expect": { "needsReply": true, "severity": "high" } },
  { "id": "r-B-implicit-ko", "kind": "B",
    "input": { "subject": "지난번 그 건", "snippet": "한번 봐주실 수 있으실까 해서요",
      "lastSenderEmail": "boss@acme.com", "ownerEmail": "me@x.com", "lastSenderIsOwner": false },
    "expect": { "needsReply": true, "severity": "med" } },
  { "id": "r-B-soft-ko", "kind": "B",
    "input": { "subject": "공유드립니다", "snippet": "검토 의견 있으면 알려주세요",
      "lastSenderEmail": "peer@acme.com", "ownerEmail": "me@x.com", "lastSenderIsOwner": false },
    "expect": { "needsReply": true, "severity": "med" } },
  { "id": "r-C-newsletter-q", "kind": "C",
    "input": { "subject": "오늘의 질문: 당신은 준비됐나요?", "snippet": "구독 해지는 여기서 unsubscribe",
      "lastSenderEmail": "news@promo.com", "ownerEmail": "me@x.com", "lastSenderIsOwner": false },
    "expect": { "needsReply": false } },
  { "id": "r-C-marketing-urgent", "kind": "C",
    "input": { "subject": "긴급 할인! 오늘까지", "snippet": "지금 구매하세요 마감 임박",
      "lastSenderEmail": "sale@shop.com", "ownerEmail": "me@x.com", "lastSenderIsOwner": false },
    "expect": { "needsReply": false } },
  { "id": "r-C-survey-please", "kind": "C",
    "input": { "subject": "설문 부탁드립니다", "snippet": "please review 자동 발송된 설문입니다",
      "lastSenderEmail": "survey@tool.com", "ownerEmail": "me@x.com", "lastSenderIsOwner": false },
    "expect": { "needsReply": false } }
]
```

- [ ] **Step 2: important.json 작성**

```json
[
  { "id": "i-receipt", "input": { "subject": "[영수증] 스타벅스 27,500원 결제 완료",
      "fromName": "스타벅스", "fromEmail": "no-reply@starbucks.com", "snippet": "결제가 완료되었습니다",
      "receivedAtKst": "2026-06-17 09:00 KST" },
    "signals": { "hasListUnsubscribe": false, "hasListId": false, "precedence": null,
      "fromHeader": "no-reply@starbucks.com" },
    "expect": { "isMailingList": false, "category": "money", "importance": "med" } },
  { "id": "i-invoice-overdue", "input": { "subject": "청구서 미납 안내",
      "fromName": "KT", "fromEmail": "billing@kt.com", "snippet": "납부 기한이 지났습니다",
      "receivedAtKst": "2026-06-17 10:00 KST" },
    "signals": { "hasListUnsubscribe": false, "hasListId": false, "precedence": null,
      "fromHeader": "billing@kt.com" },
    "expect": { "isMailingList": false, "category": "money", "importance": "high" } },
  { "id": "i-login-alert", "input": { "subject": "새 기기에서 로그인",
      "fromName": "Google", "fromEmail": "no-reply@accounts.google.com",
      "snippet": "의심스러운 활동이 감지되었습니다", "receivedAtKst": "2026-06-17 11:00 KST" },
    "signals": { "hasListUnsubscribe": false, "hasListId": false, "precedence": null,
      "fromHeader": "no-reply@accounts.google.com" },
    "expect": { "isMailingList": false, "category": "security", "importance": "high" } },
  { "id": "i-flight", "input": { "subject": "항공권 발권 완료 ICN→NRT",
      "fromName": "대한항공", "fromEmail": "no-reply@koreanair.com",
      "snippet": "6월 20일 10:00 출발 좌석 32A", "receivedAtKst": "2026-06-17 12:00 KST" },
    "signals": { "hasListUnsubscribe": false, "hasListId": false, "precedence": null,
      "fromHeader": "no-reply@koreanair.com" },
    "expect": { "isMailingList": false, "category": "schedule", "importance": "med" } },
  { "id": "i-contract-expiry", "input": { "subject": "약관 변경 안내",
      "fromName": "토스", "fromEmail": "notice@toss.im", "snippet": "7월 1일부터 약관이 변경됩니다",
      "receivedAtKst": "2026-06-17 13:00 KST" },
    "signals": { "hasListUnsubscribe": false, "hasListId": false, "precedence": null,
      "fromHeader": "notice@toss.im" },
    "expect": { "isMailingList": false, "category": "notice", "importance": "med" } },
  { "id": "i-newsletter-cut", "input": { "subject": "이번 주 Medium 다이제스트",
      "fromName": "Medium", "fromEmail": "noreply@medium.com", "snippet": "추천 글 모음 unsubscribe",
      "receivedAtKst": "2026-06-17 14:00 KST" },
    "signals": { "hasListUnsubscribe": true, "hasListId": true, "precedence": "bulk",
      "fromHeader": "noreply@medium.com" },
    "expect": { "isMailingList": true } },
  { "id": "i-promo-cut", "input": { "subject": "여름 세일 50%",
      "fromName": "Shop", "fromEmail": "promo@shop.com", "snippet": "지금 구매 unsubscribe here",
      "receivedAtKst": "2026-06-17 15:00 KST" },
    "signals": { "hasListUnsubscribe": true, "hasListId": false, "precedence": "bulk",
      "fromHeader": "promo@shop.com" },
    "expect": { "isMailingList": true } },
  { "id": "i-none-personal", "input": { "subject": "주말 등산 가실래요?",
      "fromName": "친구", "fromEmail": "friend@gmail.com", "snippet": "토요일 북한산 어때요",
      "receivedAtKst": "2026-06-17 16:00 KST" },
    "signals": { "hasListUnsubscribe": false, "hasListId": false, "precedence": null,
      "fromHeader": "friend@gmail.com" },
    "expect": { "isMailingList": false, "category": "none" } },
  { "id": "i-none-chat", "input": { "subject": "점심 뭐 먹지",
      "fromName": "동료", "fromEmail": "coworker@acme.com", "snippet": "오늘 메뉴 추천 좀",
      "receivedAtKst": "2026-06-17 17:00 KST" },
    "signals": { "hasListUnsubscribe": false, "hasListId": false, "precedence": null,
      "fromHeader": "coworker@acme.com" },
    "expect": { "isMailingList": false, "category": "none" } }
]
```

- [ ] **Step 3: fixture Zod 검증 테스트 작성**

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ReplyFixtureArraySchema,
  ImportantFixtureArraySchema,
} from "./types";

const DIR = join(__dirname, "fixtures");
const load = (f: string) =>
  JSON.parse(readFileSync(join(DIR, f), "utf-8"));

describe("eval fixtures", () => {
  it("reply-needed.json — Zod 스키마 통과 + id 고유", () => {
    const parsed = ReplyFixtureArraySchema.parse(load("reply-needed.json"));
    expect(parsed.length).toBeGreaterThanOrEqual(9);
    const ids = parsed.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reply-needed.json — needsReply=true 케이스는 severity 보유", () => {
    const parsed = ReplyFixtureArraySchema.parse(load("reply-needed.json"));
    for (const f of parsed.filter((x) => x.expect.needsReply)) {
      expect(f.expect.severity, `${f.id} severity 누락`).toBeDefined();
    }
  });

  it("important.json — Zod 스키마 통과 + 컷 아닌 행은 category 보유", () => {
    const parsed = ImportantFixtureArraySchema.parse(load("important.json"));
    expect(parsed.length).toBeGreaterThanOrEqual(9);
    for (const f of parsed.filter((x) => !x.expect.isMailingList)) {
      expect(f.expect.category, `${f.id} category 누락`).toBeDefined();
    }
  });
});
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd apps/dashboard && pnpm vitest run tests/eval/fixtures.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/tests/eval/fixtures/ apps/dashboard/tests/eval/fixtures.test.ts
git commit -m "feat(email-eval): golden fixture (답장/중요) + Zod 검증 테스트"
```

---

## Task 4: Layer 1 — 답장 deterministic recall + severity 스냅샷

**Files:**
- Create: `apps/dashboard/tests/eval/thresholds.json`
- Test: `apps/dashboard/tests/eval/reply-deterministic.eval.test.ts`

- [ ] **Step 1: thresholds.json 작성 (placeholder)**

```json
{
  "replyDeterministic": { "recall": null },
  "replyLlm": { "precision": null, "recall": null },
  "importantLlm": { "categoryMacroF1": null, "importanceAccuracy": null }
}
```

- [ ] **Step 2: Layer 1 답장 eval 테스트 작성**

> 동작: A·B(needsReply=true) fixture를 `classifyDeterministic`에 넣어 recall 계산. C는 false라
> recall 대상 아님. recall 임계치가 null이면 측정값만 로그하고 skip(베이스라인 전). 임계치가
> 채워지면 그 값으로 hard 게이트. severity는 A 케이스(deterministic이 잡는 것)만 exact-match.

```typescript
// Layer 1 — deterministic 답장 분류 회귀 게이트. LLM 없음, 매 PR.
// spec 2026-06-17 §3 §5. recall = reply 트랙 recall의 상한.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyDeterministic } from "@/entities/email/lib/deterministic-classifier";
import type { ThreadInput } from "@/entities/email/model/types";
import { binaryMetrics } from "./scorer";
import { ReplyFixtureArraySchema, ThresholdsSchema } from "./types";

const fixtures = ReplyFixtureArraySchema.parse(
  JSON.parse(readFileSync(join(__dirname, "fixtures/reply-needed.json"), "utf-8")),
);
const thresholds = ThresholdsSchema.parse(
  JSON.parse(readFileSync(join(__dirname, "thresholds.json"), "utf-8")),
);

// fixture input → ThreadInput (receivedAt·threadId는 deterministic 로직에 무관, 채워줌).
function toThreadInput(f: (typeof fixtures)[number]): ThreadInput {
  return {
    threadId: f.id,
    lastSenderEmail: f.input.lastSenderEmail,
    lastSenderName: f.input.lastSenderName,
    subject: f.input.subject,
    snippet: f.input.snippet,
    receivedAt: new Date("2026-06-17T00:00:00Z"),
    ownerEmail: f.input.ownerEmail,
    lastSenderIsOwner: f.input.lastSenderIsOwner,
  };
}

describe("Layer 1 — deterministic 답장 recall", () => {
  const cases = fixtures.map((f) => {
    const result = classifyDeterministic(toThreadInput(f));
    return { predicted: result !== null, expected: f.expect.needsReply };
  });
  const m = binaryMetrics(cases);

  it("recall 측정값 로그 + 임계치 게이트", () => {
    // 베이스라인 전(null)이면 측정만, 채워지면 hard 게이트.
    console.log(
      `[eval] deterministic recall=${m.recall.toFixed(3)} (tp=${m.tp} fn=${m.fn}) ` +
        `threshold=${thresholds.replyDeterministic.recall ?? "TBD"}`,
    );
    if (thresholds.replyDeterministic.recall !== null) {
      expect(m.recall).toBeGreaterThanOrEqual(thresholds.replyDeterministic.recall);
    } else {
      expect(m.recall).toBeGreaterThanOrEqual(0); // placeholder — 항상 통과
    }
  });

  it("severity exact-match — deterministic이 잡은 needsReply 케이스", () => {
    for (const f of fixtures.filter((x) => x.expect.needsReply && x.expect.severity)) {
      const result = classifyDeterministic(toThreadInput(f));
      if (result === null) continue; // B 케이스: 못 잡는 게 정상, severity 비교 제외
      expect(result.severity, `${f.id} severity 회귀`).toBe(f.expect.severity);
    }
  });
});
```

- [ ] **Step 3: 테스트 실행 확인**

Run: `cd apps/dashboard && pnpm vitest run tests/eval/reply-deterministic.eval.test.ts`
Expected: PASS (2 tests) + 콘솔에 `[eval] deterministic recall=...` 로그

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/tests/eval/thresholds.json apps/dashboard/tests/eval/reply-deterministic.eval.test.ts
git commit -m "feat(email-eval): Layer 1 답장 deterministic recall + severity 스냅샷"
```

---

## Task 5: Layer 1 — 중요 mailing-list 컷 회귀

**Files:**
- Test: `apps/dashboard/tests/eval/important-mailinglist.eval.test.ts`

- [ ] **Step 1: mailing-list 컷 eval 테스트 작성**

```typescript
// Layer 1 — 중요 트랙 mailing-list 컷 회귀. LLM 없음, 매 PR.
// 중요 분류 자체는 LLM 몫이라 Layer 2에서 측정. 여기선 isMailingList exact-match만.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isMailingList } from "@/entities/email/lib/unsubscribe-filter";
import { accuracy } from "./scorer";
import { ImportantFixtureArraySchema } from "./types";

const fixtures = ImportantFixtureArraySchema.parse(
  JSON.parse(readFileSync(join(__dirname, "fixtures/important.json"), "utf-8")),
);

describe("Layer 1 — mailing-list 컷", () => {
  it("isMailingList exact-match — 전수 일치", () => {
    const cases = fixtures.map((f) => ({
      predicted: isMailingList(f.signals, f.input.snippet),
      expected: f.expect.isMailingList,
    }));
    const acc = accuracy(cases);
    console.log(`[eval] mailing-list 컷 accuracy=${acc.toFixed(3)}`);
    // 컷은 결정적 — 회귀 시 즉시 빨강.
    for (const f of fixtures) {
      expect(
        isMailingList(f.signals, f.input.snippet),
        `${f.id} mailing-list 컷 회귀`,
      ).toBe(f.expect.isMailingList);
    }
  });
});
```

- [ ] **Step 2: 테스트 통과 확인**

Run: `cd apps/dashboard && pnpm vitest run tests/eval/important-mailinglist.eval.test.ts`
Expected: PASS (1 test)

- [ ] **Step 3: 전체 eval suite 동작 확인 (Layer 1 통합)**

Run: `cd apps/dashboard && pnpm vitest run tests/eval/`
Expected: PASS (scorer 6 + fixtures 3 + reply 2 + mailing-list 1 = 12 tests)

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/tests/eval/important-mailinglist.eval.test.ts
git commit -m "feat(email-eval): Layer 1 mailing-list 컷 회귀 테스트"
```

---

## Task 6: Layer 2 — 실제 Haiku eval 스크립트 + 리포트

**Files:**
- Create: `apps/dashboard/tests/eval/run-llm-eval.ts`
- Modify: `apps/dashboard/package.json` (scripts에 `eval:llm` 추가)
- Modify: `.gitignore` (`tests/eval/reports/` 추가)

> **주의:** 이 스크립트는 실제 cli-proxy를 호출한다 (on-prem 전용). vitest로 돌리지 않는다
> (비결정성·내부망). tsx로 실행. 임계치 미달은 **차단 안 함** — WARN 리포트만.

- [ ] **Step 1: run-llm-eval.ts 작성**

```typescript
// Layer 2 — 실제 Haiku 호출 정확도 리포트. on-prem 전용 (cli-proxy 내부망).
// 실행: pnpm eval:llm. PR 차단 X — 리포트만 (spec 2026-06-17 §6.2).
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { classifyWithLLM } from "@/shared/lib/llm/classify-thread";
import { classifyImportantWithLlm } from "@/shared/lib/llm/classify-important";
import { binaryMetrics, macroF1, accuracy } from "./scorer";
import {
  ReplyFixtureArraySchema,
  ImportantFixtureArraySchema,
  ThresholdsSchema,
} from "./types";

const DIR = __dirname;
const load = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf-8"));

async function main() {
  const replyFx = ReplyFixtureArraySchema.parse(load("fixtures/reply-needed.json"));
  const importantFx = ImportantFixtureArraySchema.parse(load("fixtures/important.json"));
  const thresholds = ThresholdsSchema.parse(load("thresholds.json"));

  let skipped = 0;

  // ── 답장 트랙 (full pipeline: LLM) ──────────────────────────────
  const replyCases: { predicted: boolean; expected: boolean }[] = [];
  for (const f of replyFx) {
    try {
      const r = await classifyWithLLM({
        fromEmail: f.input.lastSenderEmail,
        fromName: f.input.lastSenderName,
        subject: f.input.subject,
        snippet: f.input.snippet,
      });
      if (r.kind === "llm-unavailable") {
        console.error(`[eval] LLM unavailable: ${r.error}`);
        skipped++;
        continue;
      }
      replyCases.push({
        predicted: r.kind === "needs-reply",
        expected: f.expect.needsReply,
      });
    } catch (err) {
      console.error(`[eval] reply ${f.id} 실패:`, err instanceof Error ? err.message : err);
      skipped++;
    }
  }
  const replyM = binaryMetrics(replyCases);

  // ── 중요 트랙 (full pipeline: LLM, mailing-list 컷 통과한 것만) ──
  const catCases: { predicted: string; expected: string }[] = [];
  const impCases: { predicted: string; expected: string }[] = [];
  for (const f of importantFx) {
    if (f.expect.isMailingList) continue; // 컷 대상은 LLM 안 감
    try {
      const r = await classifyImportantWithLlm(f.input);
      const predictedCat = r === null ? "none" : r.category;
      catCases.push({ predicted: predictedCat, expected: f.expect.category ?? "none" });
      if (r !== null && f.expect.importance) {
        impCases.push({ predicted: r.importance, expected: f.expect.importance });
      }
    } catch (err) {
      console.error(`[eval] important ${f.id} 실패:`, err instanceof Error ? err.message : err);
      skipped++;
    }
  }
  const catF1 = macroF1(catCases, ["money", "security", "schedule", "notice", "none"]);
  const impAcc = accuracy(impCases);

  // ── 리포트 ──────────────────────────────────────────────────────
  const report = {
    generatedAt: new Date().toISOString(),
    skipped,
    reply: {
      precision: replyM.precision, recall: replyM.recall, f1: replyM.f1,
      tp: replyM.tp, fp: replyM.fp, fn: replyM.fn,
    },
    important: { categoryMacroF1: catF1, importanceAccuracy: impAcc, n: catCases.length },
  };

  const gate = (val: number, th: number | null) =>
    th === null ? "TBD" : val >= th ? "PASS" : "WARN";

  console.log("\n=== Email Classification Eval (Layer 2, Haiku) ===");
  console.log(`평가 불가(skip): ${skipped}건`);
  console.log(`\n[답장] precision=${replyM.precision.toFixed(3)} recall=${replyM.recall.toFixed(3)} f1=${replyM.f1.toFixed(3)}`);
  console.log(`  precision gate: ${gate(replyM.precision, thresholds.replyLlm.precision)}`);
  console.log(`  recall gate: ${gate(replyM.recall, thresholds.replyLlm.recall)}`);
  console.log(`\n[중요] categoryMacroF1=${catF1.toFixed(3)} importanceAccuracy=${impAcc.toFixed(3)}`);
  console.log(`  category gate: ${gate(catF1, thresholds.importantLlm.categoryMacroF1)}`);
  console.log(`  importance gate: ${gate(impAcc, thresholds.importantLlm.importanceAccuracy)}`);

  const outDir = join(DIR, "reports");
  mkdirSync(outDir, { recursive: true });
  const stamp = report.generatedAt.slice(0, 10);
  const outPath = join(outDir, `${stamp}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n리포트 저장: ${outPath}`);
}

main().catch((err) => {
  console.error("[eval] 치명적 실패:", err);
  process.exit(1);
});
```

- [ ] **Step 2: package.json에 스크립트 추가**

`apps/dashboard/package.json`의 `scripts`에 추가 (기존 `test:watch` 줄 뒤):

```json
    "eval:llm": "tsx --conditions=react-server tests/eval/run-llm-eval.ts"
```

> `--conditions=react-server`: classify-thread.ts가 `import "server-only"`를 쓰므로 다른
> `db:seed:*` 스크립트와 동일하게 react-server 조건 필요.

- [ ] **Step 3: .gitignore에 reports 추가**

`.gitignore`의 graphify-out 항목 뒤에 추가:

```
# eval Layer 2 리포트 (로컬 전용)
apps/dashboard/tests/eval/reports/
```

- [ ] **Step 4: 타입 체크 + 스크립트 로드 검증 (LLM 미호출)**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS

> 실제 `pnpm eval:llm` 실행은 cli-proxy 접근이 필요하므로 Task 7(베이스라인)에서. 여기선 타입만.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/tests/eval/run-llm-eval.ts apps/dashboard/package.json .gitignore
git commit -m "feat(email-eval): Layer 2 Haiku eval 스크립트 + eval:llm 명령 + reports gitignore"
```

---

## Task 7: 베이스라인 측정 + 임계치 확정

**Files:**
- Modify: `apps/dashboard/tests/eval/thresholds.json` (null → 측정값 기반)

> **전제:** cli-proxy(`ANTHROPIC_BASE_URL`) 접근 가능한 환경(localhost가 192.168.0.5 도달 가능
> 또는 on-prem). `apps/dashboard/.env`에 `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY` 설정 확인.

- [ ] **Step 1: Layer 1 deterministic recall 베이스라인 확인**

Run: `cd apps/dashboard && pnpm vitest run tests/eval/reply-deterministic.eval.test.ts`
콘솔의 `[eval] deterministic recall=X.XXX` 값을 기록.

- [ ] **Step 2: Layer 2 Haiku 베이스라인 측정**

Run: `cd apps/dashboard && pnpm eval:llm`
Expected: 리포트 출력 + `reports/<date>.json` 저장. `평가 불가(skip): 0건`이어야 정상
(skip > 0이면 cli-proxy 연결 문제 — 해결 후 재실행).

- [ ] **Step 3: 측정값 기반 thresholds.json 확정**

각 측정값에서 **약 -0.05 마진**을 빼서 채운다 (정상 변동 허용, 명확한 회귀만 차단).
예시 (실제 값으로 교체):

```json
{
  "replyDeterministic": { "recall": 0.60 },
  "replyLlm": { "precision": 0.85, "recall": 0.85 },
  "importantLlm": { "categoryMacroF1": 0.70, "importanceAccuracy": 0.75 }
}
```

> deterministic recall은 B 케이스 때문에 1.0 미만이 정상 — 측정값 그대로 마진 적용.
> Layer 2 임계치는 리포트가 WARN/PASS 판정에만 쓰임 (PR 차단 X).

- [ ] **Step 4: Layer 1 게이트 활성화 확인**

Run: `cd apps/dashboard && pnpm vitest run tests/eval/reply-deterministic.eval.test.ts`
Expected: PASS — 이제 recall 임계치가 hard 게이트로 동작 (현재 측정값 ≥ 임계치이므로 통과).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/tests/eval/thresholds.json
git commit -m "feat(email-eval): 베이스라인 측정 후 임계치 확정"
```

---

## Task 8: 전체 검증 + 문서 갱신

**Files:**
- Modify: `apps/dashboard/CLAUDE.md` 또는 root `CLAUDE.md`의 Health Stack 섹션 (eval 명령 안내)

- [ ] **Step 1: 전체 테스트 통과 (Layer 1이 기존 suite에 통합됐는지)**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test`
Expected: 기존 테스트 + eval Layer 1 12건 모두 통과 (DB 통합은 ECONNREFUSED 허용 — Gotcha #2).

- [ ] **Step 2: typecheck + lint**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: PASS (FSD boundary 위반 없음 — tests/는 boundaries 룰 적용 안 받지만 import 경로 확인).

- [ ] **Step 3: CLAUDE.md에 eval 명령 한 줄 추가**

root `CLAUDE.md`의 검증 명령 블록 또는 "Health Stack" 근처에 추가:

```
pnpm --filter @gons/dashboard eval:llm   # Layer 2 분류 정확도 측정 (on-prem, cli-proxy 필요)
```

> Layer 1은 `pnpm test`에 자동 포함이라 별도 명령 불필요.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(email-eval): eval:llm 명령 안내 추가"
```

- [ ] **Step 5: 최종 상태 확인**

Run: `cd apps/dashboard && pnpm vitest run tests/eval/ --reporter=verbose`
Expected: 12 tests pass, deterministic recall 로그 출력.
```
