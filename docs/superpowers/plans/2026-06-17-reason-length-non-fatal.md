# reason/summary 길이 verdict 무효화 수정 (#145) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 답장·중요 분류기 스키마에서 reason/summary/rationale의 길이 제약(`.max()`)을 제거해, 부수 텍스트 필드의 길이 초과가 분류 verdict 전체를 무효화하지 못하게 한다.

**Architecture:** 버그의 단위는 스키마. 3개 필드의 `.max()`를 제거하고 스키마를 export해 게이트웨이·mock 없이 직접 `safeParse`하는 순수 단위 테스트로 가드한다. PR #144가 추가한 "81자 거부" 테스트가 충돌하므로 반전한다. UI는 ReplyBadges 뱃지에 truncate를 더해 긴 reason의 폭주를 막는다.

**Tech Stack:** TypeScript, Zod, Vitest, Tailwind. DB(text 컬럼)·마이그레이션 무관.

설계 문서: `docs/superpowers/specs/2026-06-17-reason-length-non-fatal-design.md`

---

## File Structure

- **Modify** `apps/dashboard/src/shared/lib/llm/classify-thread.ts` (line 28)
  — `reason: z.string().min(1).max(80)` → `.min(1)`. 스키마는 PR #144에서 이미 export됨.
- **Modify** `apps/dashboard/src/shared/lib/llm/classify-important.ts` (line 29, 32, 35-36)
  — `SUMMARY_MAX` 삭제, `ResponseSchema` export, summary/rationale `.max()` 제거.
- **Modify** `apps/dashboard/tests/eval/llm-classify-thread-schema.test.ts` (line 21-29)
  — "81자 거부" 케이스를 "긴 reason 수용"으로 반전 (PR #144 충돌 해소).
- **Create** `apps/dashboard/tests/eval/llm-classify-important-schema.test.ts`
  — 중요 트랙 ResponseSchema 직접 테스트 (300자 summary/rationale 수용).
- **Modify** `apps/dashboard/src/widgets/email-digest/ui/ReplyBadges.tsx` (line 39-45)
  — reason 뱃지 span에 max-width + truncate.

---

## Task 1: 답장 트랙 — 충돌 테스트 반전 (RED) → reason max 제거 (GREEN)

PR #144가 추가한 "81자 거부" 단언이 max 제거와 충돌한다. 먼저 테스트를 반전(RED), 그 다음 스키마에서 max 제거(GREEN).

**Files:**
- Modify: `apps/dashboard/tests/eval/llm-classify-thread-schema.test.ts:21-29`
- Modify: `apps/dashboard/src/shared/lib/llm/classify-thread.ts:28`

- [ ] **Step 1: 충돌 테스트를 반전 (RED)**

`llm-classify-thread-schema.test.ts`의 21-29줄 `it("81자 reason은 거부한다 ...")` 블록을 다음으로 **교체**:

```ts
  it("80자 초과 긴 reason도 수용한다 (verdict가 reason 길이에 무효화되지 않음)", () => {
    const reason = "x".repeat(200);
    const result = LlmResponseSchema.safeParse({
      needs_reply: false,
      severity: "low",
      reason,
    });
    expect(result.success).toBe(true);
  });
```

60자 수용 케이스(9-19줄)는 그대로 둔다. 12줄의 `expect(reason.length).toBeLessThanOrEqual(80);`는 그 케이스 reason엔 여전히 참이라 유지해도 무방 — 그대로 둔다.

- [ ] **Step 2: 테스트 실행 → 반전 케이스가 FAIL (RED)**

Run:
```bash
cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run tests/eval/llm-classify-thread-schema.test.ts
```
Expected: FAIL — 200자 reason이 현재 `max(80)`이라 `success: false` → "긴 reason 수용" 단언 실패.

> 로컬 테스트 DB가 없으면 먼저 기동 (CLAUDE.md Gotcha #2):
> ```bash
> docker run -d --rm --name gons-test-db -p 5999:5432 \
>   -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=test_dummy postgres:16-alpine
> ```

- [ ] **Step 3: reason max 제거 (GREEN)**

`classify-thread.ts:28`:
```ts
// before
  reason: z.string().min(1).max(80),
// after
  reason: z.string().min(1),
```

위 22-24줄의 "reason.max(80): ..." 설명 주석도 max 제거에 맞게 갱신:
```ts
// reason 길이 제약 제거(#145): reason은 UI 표시용 부수 텍스트인데 길이 초과가
// 게이트웨이 Zod 검증을 실패시켜 verdict(needs_reply/severity) 전체를 무효화하던
// 버그 수정. 프롬프트는 한국어 40자 소프트 가이드 유지(UI 일관성).
```

- [ ] **Step 4: 테스트 실행 → PASS (GREEN)**

Run:
```bash
cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run tests/eval/llm-classify-thread-schema.test.ts
```
Expected: PASS (2 passed) — 60자 수용 + 200자 수용.

- [ ] **Step 5: 커밋**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/tests/eval/llm-classify-thread-schema.test.ts apps/dashboard/src/shared/lib/llm/classify-thread.ts
git commit -m "fix(email-classify): 답장 reason max 제거 — 길이가 verdict 무효화하지 않게 (#145)"
```

---

## Task 2: 중요 트랙 — ResponseSchema export + 신규 테스트 (RED) → max 제거 (GREEN)

중요 트랙의 ResponseSchema는 현재 비공개고 직접 테스트가 없다. export + 신규 테스트(RED) → max 제거 + SUMMARY_MAX orphan 삭제(GREEN).

**Files:**
- Modify: `apps/dashboard/src/shared/lib/llm/classify-important.ts:29,32,35-36`
- Create: `apps/dashboard/tests/eval/llm-classify-important-schema.test.ts`

- [ ] **Step 1: ResponseSchema를 export로 변경**

`classify-important.ts:32`:
```ts
// before
const ResponseSchema = z.object({
// after
export const ResponseSchema = z.object({
```

(이 단계만으로는 max가 아직 살아있어 다음 RED 테스트가 fail한다 — 의도된 RED.)

- [ ] **Step 2: 신규 스키마 테스트 작성 (RED)**

`apps/dashboard/tests/eval/llm-classify-important-schema.test.ts` 생성:

```ts
// 중요 트랙 ResponseSchema 직접 단위 테스트 — summary/rationale 길이 회귀 가드.
// 게이트웨이가 앱이 넘긴 이 스키마로 내부 검증하므로(tryParseAndValidate),
// 길이 제약이 verdict(category/importance)를 무효화하지 않는지 스키마를 직접 친다.
// mock·LLM·DB 의존 없음.
import { describe, it, expect } from "vitest";
import { ResponseSchema } from "@/shared/lib/llm/classify-important";

describe("중요 트랙 ResponseSchema 길이", () => {
  it("200자 초과 summary/rationale도 수용한다 (verdict 무효화 방지)", () => {
    const result = ResponseSchema.safeParse({
      category: "money",
      importance: "high",
      summary: "가".repeat(300),
      rationale: "나".repeat(300),
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 3: 테스트 실행 → FAIL (RED)**

Run:
```bash
cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run tests/eval/llm-classify-important-schema.test.ts
```
Expected: FAIL — 300자 summary/rationale가 현재 `max(200)`이라 `success: false`.

- [ ] **Step 4: max 제거 + SUMMARY_MAX orphan 삭제 (GREEN)**

`classify-important.ts:35-36`:
```ts
// before
  summary: z.string().max(SUMMARY_MAX),
  rationale: z.string().max(200),
// after
  summary: z.string(),
  rationale: z.string(),
```

`classify-important.ts:29` — `SUMMARY_MAX`가 이제 미사용이므로 삭제:
```ts
// before
const SUMMARY_MAX = 200;
const MAX_OUTPUT_TOKENS = 600;
// after
const MAX_OUTPUT_TOKENS = 600;
```

(SYSTEM_PROMPT의 "최대 200자" 소프트 가이드는 변경하지 않는다. `MAX_OUTPUT_TOKENS`는 line 77에서 사용 중이라 유지.)

- [ ] **Step 5: 테스트 실행 → PASS (GREEN)**

Run:
```bash
cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run tests/eval/llm-classify-important-schema.test.ts
```
Expected: PASS (1 passed).

- [ ] **Step 6: 커밋**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/shared/lib/llm/classify-important.ts apps/dashboard/tests/eval/llm-classify-important-schema.test.ts
git commit -m "fix(email-classify): 중요 트랙 summary/rationale max 제거 + SUMMARY_MAX 정리 (#145)"
```

---

## Task 3: UI — ReplyBadges reason 뱃지 truncate

긴 reason이 뱃지(pill)를 폭주시키지 않게 truncate를 더한다. important row(ImportantEmailRow.tsx:90)는 이미 line-clamp-3이라 무변경.

**Files:**
- Modify: `apps/dashboard/src/widgets/email-digest/ui/ReplyBadges.tsx:39-45`

- [ ] **Step 1: reason 뱃지 span에 max-width + truncate 추가**

`ReplyBadges.tsx`의 39-45줄, reason을 감싸는 `<span>`. 현재:

```tsx
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-hairline-strong)] bg-[var(--color-surface)] px-2 py-0.5 text-tiny font-medium text-[var(--color-text-muted)]">
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-current opacity-55"
        />
        {reason}
      </span>
```

변경 후 (바깥 span에 `max-w-[16rem]`, 점 표식에 `shrink-0`, reason 텍스트를 `truncate` inner span으로 분리 — flex 안에서 truncate가 동작하게):

```tsx
      <span className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border border-[var(--color-hairline-strong)] bg-[var(--color-surface)] px-2 py-0.5 text-tiny font-medium text-[var(--color-text-muted)]">
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-55"
        />
        <span className="truncate">{reason}</span>
      </span>
```

- [ ] **Step 2: typecheck + lint**

Run:
```bash
cd apps/dashboard && pnpm typecheck && pnpm lint
```
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/widgets/email-digest/ui/ReplyBadges.tsx
git commit -m "fix(email-digest): ReplyBadges reason 뱃지 truncate — 긴 reason 폭주 방지 (#145)"
```

---

## Task 4: DB 주석 정정 + 전체 검증

**Files:**
- Modify: `apps/dashboard/src/shared/lib/db/schema/email.ts:89`

- [ ] **Step 1: summary 컬럼 주석 정정**

`email.ts:89`의 "≤ 200자 한국어" 주석이 max 제거로 부정확해짐. 현재:
```ts
    summary: text("summary").notNull(), // ≤ 200자 한국어
```
변경:
```ts
    summary: text("summary").notNull(), // 한국어 요약 (프롬프트 소프트 가이드 ~200자, 스키마 길이 제약 없음)
```

- [ ] **Step 2: 전체 테스트 회귀 확인 (baseline 비교)**

Run:
```bash
cd /home/gon/projects/gon/gons-dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test 2>&1 | grep -E "Tests.*(failed|passed)"
```
Expected: 신규/수정 스키마 테스트 PASS. DB 통합 테스트는 로컬 DB 상태에 따라 다름 — **새로 깨진 pure unit 테스트가 없어야** 한다. 기존 `classify-important-thread.test.ts`(gateway mock)는 길이 제약에 의존하지 않으므로 영향 없어야 함.

> 의심되면 baseline 비교 (PR #144 Task 3 패턴): 직전 main과 fail 수를 비교해 "새로 깨진 것 0개" 확인.

- [ ] **Step 3: typecheck + lint 최종**

Run:
```bash
cd apps/dashboard && pnpm typecheck && pnpm lint
```
Expected: 에러 없음. 변경 파일(classify-thread, classify-important, 두 테스트, ReplyBadges, email.ts)에 lint 이슈 없음.

- [ ] **Step 4: 커밋**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/shared/lib/db/schema/email.ts
git commit -m "docs(email-classify): summary 컬럼 주석 정정 — max 제거 반영 (#145)"
```

---

## Task 5: PR 생성

**Files:** (없음 — PR)

- [ ] **Step 1: push + PR 생성**

```bash
cd /home/gon/projects/gon/gons-dashboard
git push -u origin fix/reason-length-non-fatal
gh pr create --title "fix(email-classify): reason/summary 길이가 verdict를 무효화하는 문제 수정 (#145)" --body "$(cat <<'EOF'
## 배경 (이슈 #145)

분류기 스키마의 `reason`/`summary`/`rationale`은 UI·디버깅용 부수 텍스트인데, 길이 제약(`.max(80)`/`.max(200)`)이 게이트웨이 Zod 검증을 실패시켜 **분류 verdict 전체를 무효화**한다.

- 답장 트랙: reason>80 → llm-unavailable → deterministic fallback FP (잘못 flag)
- 중요 트랙: summary/rationale>200 → throw → skipped-llm-error (놓침/FN)

PR #146으로 복구된 eval Layer 2 첫 run에서 reason>80 다수 관측 → 노출.

## 변경

- `classify-thread.ts`: `reason.max(80)` 제거.
- `classify-important.ts`: `summary/rationale.max(200)` 제거 + `SUMMARY_MAX` orphan 삭제 + `ResponseSchema` export.
- 회귀 테스트(스키마 직접 safeParse, CI): 답장 "81자 거부" 케이스를 "긴 reason 수용"으로 **반전**(PR #144와 충돌 해소) + 중요 트랙 신규 테스트(300자 수용).
- `ReplyBadges.tsx`: reason 뱃지 truncate (important row는 이미 line-clamp-3).
- 프롬프트의 "40자/200자" 소프트 가이드는 유지 → reason 폭주 방지.

## DB / 자가 치유

세 컬럼 모두 text 타입 → max 제거해도 DB 에러 없음, 마이그레이션 불필요. 기존 오분류는 다음 poll에서 재분류.

## 설계 / 계획

- spec: `docs/superpowers/specs/2026-06-17-reason-length-non-fatal-design.md`
- plan: `docs/superpowers/plans/2026-06-17-reason-length-non-fatal.md`

## Test plan

- [x] 답장 스키마 테스트 반전 (긴 reason 수용) GREEN
- [x] 중요 스키마 신규 테스트 (300자 수용) GREEN
- [x] `pnpm typecheck && pnpm lint` (SUMMARY_MAX orphan 제거)
- [x] 전체 테스트 무회귀 확인
EOF
)"
```
Expected: PR URL 출력. CI 자동 트리거.

---

## 완료 기준

- [ ] `classify-thread.ts` reason, `classify-important.ts` summary/rationale에서 `.max()` 제거됨.
- [ ] `SUMMARY_MAX` orphan 삭제, `ResponseSchema` export됨.
- [ ] 답장 충돌 테스트 반전 + 중요 신규 테스트 GREEN (`pnpm test`).
- [ ] ReplyBadges reason 뱃지 truncate.
- [ ] `pnpm typecheck && pnpm lint` 통과.
- [ ] PR 생성, CI 통과.
