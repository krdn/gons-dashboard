# 영어 메일 답장 분류 reason 길이 버그 수정 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 답장 필요 분류기(`classify-thread.ts`)의 `reason.max(40)` 제약을 80자로 완화해 영어 reason이 Zod 거부 → deterministic fallback FP 되는 버그를 수정한다.

**Architecture:** 버그의 단위는 `LlmResponseSchema` 그 자체다. 스키마 한도를 80으로 올리고 스키마를 export해, 게이트웨이·mock·LLM 없이 스키마를 직접 safeParse하는 순수 단위 테스트로 CI 회귀 가드를 만든다. 프롬프트의 "한국어 40자"는 유지(UI 일관성). 이후 on-prem Layer 2 eval로 임계치를 보정한다.

**Tech Stack:** TypeScript, Zod, Vitest, `@krdn/llm-gateway`, Drizzle (무관 — 테스트는 순수).

설계 문서: `docs/superpowers/specs/2026-06-17-english-reply-reason-length-fix-design.md`

---

## File Structure

- **Modify** `apps/dashboard/src/shared/lib/llm/classify-thread.ts` (line 25-29)
  — `LlmResponseSchema`를 export로 변경 + `reason.max(40)` → `max(80)`. production 변경은 이 한 파일뿐.
- **Create** `apps/dashboard/tests/eval/llm-classify-thread-schema.test.ts`
  — 순수 safeParse 회귀 가드 (60자 영어 수용 / 81자 거부). `pnpm test`(CI)에서 동작.
- **Run + Modify** `apps/dashboard/tests/eval/thresholds.json`
  — Layer 2 run 측정 후 `replyLlm.precision`/`replyLlm.recall` 보정.
- **No change** `apps/dashboard/tests/eval/fixtures/reply-needed.json`
  — 영어 케이스 이미 존재 (r-A-deadline-en, r-A-approval-en 등 9건). 추가 불필요.

---

## Task 1: 스키마 회귀 가드 (RED) — 60자 영어 수용 / 81자 거부

이 작업은 TDD의 RED 단계다. 스키마 export 전이므로 테스트는 **import 실패 또는 60자 케이스 실패**로 떨어진다.

**Files:**
- Create: `apps/dashboard/tests/eval/llm-classify-thread-schema.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/dashboard/tests/eval/llm-classify-thread-schema.test.ts`:

```ts
// LlmResponseSchema 직접 단위 테스트 — 영어 reason 길이 회귀 가드.
// 버그의 단위는 classifyWithLLM이 아니라 스키마 자체. 게이트웨이가 내부에서
// 앱이 넘긴 이 스키마로 검증하므로(@krdn/llm-gateway runner: tryParseAndValidate),
// 스키마를 직접 safeParse하는 게 가장 정확한 회귀 가드. mock·DB·LLM 의존 없음.
import { describe, it, expect } from "vitest";
import { LlmResponseSchema } from "@/shared/lib/llm/classify-thread";

describe("LlmResponseSchema reason 길이", () => {
  it("60자 영어 reason을 수용한다 (영어 메일 fallback FP 방지)", () => {
    const reason = "Sender explicitly asks for a decision on the Q3 budget plan";
    expect(reason.length).toBeGreaterThan(40); // 40자 초과임을 명시 (~60자)
    expect(reason.length).toBeLessThanOrEqual(80);
    const result = LlmResponseSchema.safeParse({
      needs_reply: true,
      severity: "high",
      reason,
    });
    expect(result.success).toBe(true);
  });

  it("81자 reason은 거부한다 (한도 상한 고정)", () => {
    const reason = "x".repeat(81);
    const result = LlmResponseSchema.safeParse({
      needs_reply: false,
      severity: "low",
      reason,
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run:
```bash
cd apps/dashboard && pnpm vitest run tests/eval/llm-classify-thread-schema.test.ts
```
Expected: FAIL. `LlmResponseSchema`가 아직 export되지 않아 import 에러("LlmResponseSchema is not exported" / `undefined`), 또는 export됐더라도 max(40)이라 60자 케이스가 `success: false`로 실패.

- [ ] **Step 3: 커밋 (RED 테스트)**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/tests/eval/llm-classify-thread-schema.test.ts
git commit -m "test(email-classify): 스키마 reason 길이 회귀 가드 (RED)"
```

---

## Task 2: 스키마 수정 (GREEN) — export + max(80)

**Files:**
- Modify: `apps/dashboard/src/shared/lib/llm/classify-thread.ts:25-29`

- [ ] **Step 1: 스키마를 export로 변경 + reason 한도 80으로 완화**

현재 (`classify-thread.ts:25-29`):

```ts
const LlmResponseSchema = z.object({
  needs_reply: z.boolean(),
  severity: z.enum(["high", "med", "low"]),
  reason: z.string().min(1).max(40),
});
```

다음으로 변경:

```ts
// reason.max(80): 영어 reason(평균 50~70자)이 40자 제한에 걸려 Zod 거부 →
// deterministic fallback FP 되던 버그 수정. 프롬프트는 한국어 40자 유지(UI 일관성),
// 스키마는 영어/긴 reason 안전망. export는 직접 단위 테스트(스키마 회귀 가드)용.
export const LlmResponseSchema = z.object({
  needs_reply: z.boolean(),
  severity: z.enum(["high", "med", "low"]),
  reason: z.string().min(1).max(80),
});
```

SYSTEM_PROMPT(line 41 "한국어 1줄 40자 이내")는 변경하지 않는다.

- [ ] **Step 2: 테스트가 통과하는지 확인**

Run:
```bash
cd apps/dashboard && pnpm vitest run tests/eval/llm-classify-thread-schema.test.ts
```
Expected: PASS (2 passed). 60자 영어 → `success: true`, 81자 → `success: false`.

- [ ] **Step 3: typecheck + lint**

Run:
```bash
cd apps/dashboard && pnpm typecheck && pnpm lint
```
Expected: 에러 없음. (스키마 export 추가가 다른 import를 깨지 않는지 확인 — `LlmResponseSchema`는 신규 export라 기존 소비자 없음.)

- [ ] **Step 4: 커밋 (GREEN)**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/shared/lib/llm/classify-thread.ts
git commit -m "fix(email-classify): reason.max(40→80) — 영어 메일 fallback FP 수정"
```

---

## Task 3: 전체 테스트 회귀 확인

스키마 변경이 다른 분류 테스트(특히 기존 `classify-important-thread.test.ts` 등 LLM 흐름 테스트)를 깨지 않는지 확인한다.

**Files:** (없음 — 검증만)

- [ ] **Step 1: 전체 단위 테스트 실행**

Run:
```bash
cd /home/gon/projects/gon/gons-dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test
```
Expected: 신규 스키마 테스트 PASS. 기존 pure unit 테스트 PASS. DB 통합 테스트는 로컬 DB 미기동 시 `ECONNREFUSED`로 fail해도 OK (CLAUDE.md Gotcha #2 — 이 버그 수정과 무관). **새로 깨지는 pure unit 테스트가 없는지**가 합격 기준.

> 주의: 만약 기존 `classify-thread` 관련 mock 테스트가 reason 길이에 의존하는 단언을 갖고 있다면(현재 없음 — Task 작성 시 확인됨), 그건 별개로 검토. 지금은 `classify-thread` 전용 mock 테스트가 없으므로 영향 없음.

- [ ] **Step 2: (선택) DB 통합까지 보려면 로컬 테스트 DB 기동 후 재실행**

로컬 테스트 DB가 없으면 생략 가능. 기동하려면:
```bash
docker run -d --rm --name gons-test-db -p 5999:5432 \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=test_dummy \
  postgres:16-alpine
cd /home/gon/projects/gon/gons-dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test
```
Expected: 통합 포함 전체 GREEN. (이 단계는 회귀 안전망 강화용 — 필수 아님.)

---

## Task 4: Layer 2 eval run — replyLlm 임계치 보정

max(80) 수정 덕에 영어 케이스가 더 이상 skip되지 않으므로, 깨끗한 Layer 2 run으로 replyLlm precision/recall을 측정해 임계치를 보정한다. on-prem cli-proxy 접근 필요.

**Files:**
- Modify: `apps/dashboard/tests/eval/thresholds.json`
- (생성됨) `apps/dashboard/tests/eval/reports/<날짜>.json`

- [ ] **Step 1: cli-proxy 접근 가능 확인**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://192.168.0.5:8317/v1/models
```
Expected: `401` (서버 생존, 인증만 필요 — 정상). 접속 자체가 안 되면(timeout/000) Step 4로 건너뛰고 임계치는 null 유지.

- [ ] **Step 2: Layer 2 eval 실행**

Run:
```bash
cd apps/dashboard && pnpm eval:llm
```
Expected: 콘솔에 `[답장] 평가 N건 (skip M건)` 출력. **영어 케이스가 skip 없이 집계**되는지 확인 — max(80) 전이었다면 영어 케이스가 `LLM unavailable`로 skip됐을 것. precision/recall/f1 값과 `리포트 저장: .../reports/<날짜>.json` 확인.

- [ ] **Step 3: 측정값 − 마진으로 임계치 보정**

`pnpm eval:llm` 출력의 replyLlm precision/recall 측정값을 보고 `apps/dashboard/tests/eval/thresholds.json`의 `replyLlm`을 보정한다. 현재:

```json
"replyLlm": { "precision": null, "recall": null },
```

측정값에서 마진(약 0.05~0.10)을 뺀 값으로 설정. 예시 형식(실제 값은 측정 결과로 대체):

```json
"replyLlm": { "precision": 0.80, "recall": 0.75 },
```

> 마진 결정 기준: 기존 베이스라인 커밋(`d50ae66`)이 deterministic recall을 "측정값(0.529) − 마진 → 0.45"로 잡은 전례를 따른다. importantLlm도 "측정값 − 마진"(0.853→0.75, 0.765→0.65). 같은 손폭을 replyLlm에 적용.

- [ ] **Step 4: 리포트 + thresholds 커밋**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/tests/eval/thresholds.json apps/dashboard/tests/eval/reports/
git commit -m "feat(email-classify): max(80) 후 replyLlm 임계치 보정 (Layer 2 측정)"
```

> cli-proxy 접근 불가로 Step 2를 못 돌렸다면: thresholds.json은 변경하지 않고(`replyLlm` null 유지), 커밋 메시지를 `chore(email-classify): Layer 2 run 보류 — replyLlm 임계치 미보정`으로 하거나 이 Task를 건너뛴다. 정직하게 "임계치 미보정"으로 남긴다.

---

## Task 5: 최종 검증 + PR

**Files:** (없음 — 검증 + PR)

- [ ] **Step 1: 최종 typecheck + lint + 스키마 테스트**

Run:
```bash
cd apps/dashboard && pnpm typecheck && pnpm lint && pnpm vitest run tests/eval/llm-classify-thread-schema.test.ts
```
Expected: 전부 GREEN.

- [ ] **Step 2: 변경 요약 확인**

Run:
```bash
cd /home/gon/projects/gon/gons-dashboard
git log --oneline main..HEAD
git diff main..HEAD --stat
```
Expected: classify-thread.ts(1 production 파일), 신규 스키마 테스트, (Layer 2 돌렸으면) thresholds.json + reports/. spec/plan 문서.

- [ ] **Step 3: 푸시 + PR 생성**

```bash
cd /home/gon/projects/gon/gons-dashboard
git push -u origin fix/english-reply-reason-length
gh pr create --title "fix(email-classify): 영어 메일 reason 길이 버그 — max(40→80)" --body "$(cat <<'EOF'
## 배경

v0.2 이메일 분류 eval(#140)이 첫 실행에서 잡아낸 production 결함. 영어 메일의 답장 필요 분류가 `reason.max(40)`에 걸려 잘못된 결과를 낸다.

## 버그

영어 메일 → Haiku가 영어 reason 생성(평균 50~70자) → `reason.max(40)` 초과 → 게이트웨이 내부 Zod 거부 → `classifyWithLLM`이 `llm-unavailable` 반환 → `classifyThread`가 deterministic fallback으로 잘못 flag(FP).

## 변경

- `classify-thread.ts`: `reason.max(40)` → `max(80)` + `LlmResponseSchema` export. 프롬프트의 "한국어 40자"는 유지(UI 일관성), 스키마는 영어 안전망.
- 신규 스키마 직접 단위 테스트(`pnpm test` CI 회귀 가드): 60자 영어 수용 / 81자 거부. mock 접근은 게이트웨이 내부 검증 때문에 버그를 못 잡아 스키마 직접 safeParse로 가드.
- (Layer 2 run 시) `thresholds.json`의 `replyLlm` 임계치 보정.

## 자가 치유

기존 오분류 스레드는 다음 poll-gmail 주기에 재분류됨. DB 마이그레이션 불필요.

## 설계

`docs/superpowers/specs/2026-06-17-english-reply-reason-length-fix-design.md`

## Test plan

- [x] 스키마 단위 테스트 GREEN (60자 수용 / 81자 거부)
- [x] `pnpm typecheck && pnpm lint`
- [ ] (on-prem) `pnpm eval:llm` 영어 케이스 정상 집계 확인
EOF
)"
```
Expected: PR URL 출력. CI(Lint & Type Check → Build)가 자동 트리거됨.

---

## 완료 기준

- [ ] `classify-thread.ts`의 `reason` 한도가 80, `LlmResponseSchema` export됨.
- [ ] 스키마 직접 단위 테스트가 `pnpm test`에서 GREEN (60자 수용 / 81자 거부).
- [ ] `pnpm typecheck && pnpm lint` 통과.
- [ ] (가능하면) Layer 2 run으로 영어 케이스 정상 집계 확인 + replyLlm 임계치 보정.
- [ ] PR 생성, CI 통과.
