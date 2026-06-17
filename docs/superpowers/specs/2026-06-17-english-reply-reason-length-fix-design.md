# 영어 메일 답장 분류 — reason 길이 버그 수정 — 설계 문서

작성일: 2026-06-17
브랜치: (구현 시 `fix/english-reply-reason-length`)
범위: 답장 필요 분류기(`classify-thread.ts`)의 영어 reason 길이 거부로 인한 오분류(FP) 수정

## 1. 배경 & 문제

v0.2 이메일 분류 eval(PR #140)이 첫 실행에서 **실제 production 결함**을 잡아냈다. 영어 메일의 답장 필요 분류가 reason 길이 제한에 걸려 잘못된 결과를 낸다.

### 버그 메커니즘

```
영어 메일 → Haiku가 영어 reason 생성 → reason.max(40) 초과
  → analyzeStructured(게이트웨이)가 Zod 검증 실패로 throw
  → classifyWithLLM이 llm-unavailable 반환 (classify-thread.ts:81-84)
  → classifyThread가 deterministic fallback으로 flag 유지 (classifyThread.ts:91-96)
  → LLM이 "걸러내야 한다"고 판단할 기회 자체를 박탈당해 잘못된 flag (FP)
```

핵심 코드:

- `apps/dashboard/src/shared/lib/llm/classify-thread.ts:28`
  `reason: z.string().min(1).max(40)`
- 프롬프트(`:41`)는 "한국어 1줄 40자 이내"를 지시하지만, 영어 메일에서 Haiku가
  영어 reason을 생성하면 평균 50~70자라 거의 항상 40자를 초과한다.

### Production 영향

영어 junk 메일이 deterministic 패턴(긴급/질문 키워드)을 통과하면, LLM이 걸러줘야
할 것을 reason 길이 거부로 못 걸러 **fallback으로 잘못 flag(FP)** 된다.
영어 메일을 받는 사용자에게 답장 트랙 정확도 저하.

## 2. 범위 한정

**답장 트랙(`classify-thread.ts`)만** 해당한다.

- 중요 트랙(`classify-important.ts`)은 `summary.max(200)`, `rationale.max(200)`이라
  영어도 여유가 있고, `llm-unavailable` 시 fallback도 없이 throw하므로 이 버그와 무관.
- eval 베이스라인(2026-06-16)에서 중요 트랙 categoryMacroF1=0.853,
  importanceAccuracy=0.765로 건강함이 확인됨.

## 3. 설계 결정

### 결정 1 — 스키마 한도만 완화, 프롬프트는 유지

`reason.max(40)` → `reason.max(80)`. **프롬프트의 "한국어 40자"는 유지한다.**

이 비대칭이 의도된 설계다:

- 프롬프트가 한국어 reason을 유도 → UI 표시는 대체로 한국어로 일관.
- 스키마 80자는 **안전망** — Haiku가 영어로 답하거나 한국어 reason이 간혹 길어져도
  Zod가 거부하지 않아 fallback FP를 막는다.
- 언어 무관하게 견고. 영어 reason(평균 50~70자)이 통과해 LLM이 제대로
  "걸러낼" 기회를 회복한다.

**대안 기각**:

- *프롬프트 한국어 강제만*: LLM이 지시를 항상 따른다는 보장이 없어(Haiku가 가끔
  영어/초과) 간헐적 Zod 거부가 잔존. 결정적이지 않음.
- *언어별 한도 분기*: 메일 언어를 먼저 판정해야 하는 복잡도. YAGNI.

### 결정 2 — eval 미러링 변경은 범위 밖

당초 후속 후보였던 "`run-llm-eval.ts`의 `llm-unavailable` skip을 production처럼
미러링" 변경은 **하지 않는다**.

- replyLlm 메트릭이 null이었던 근본 원인이 "영어 reason → unavailable → skip"인데,
  max(80)이 그 원인을 뿌리에서 제거한다. 고친 뒤 Layer 2를 돌리면 영어 케이스가
  실제 LLM 판정을 내고 메트릭에 정상 집계되므로, 미러링 없이 깨끗한 run으로
  임계치 보정이 가능하다.
- 미러링은 fallback 동작을 LLM 정확도 메트릭에 섞어 넣는 것이라, 이 eval이
  명시적으로 분리해둔 "LLM 정확도" 의도(`reply` 리포트 필드 + all-down 가드,
  `run-llm-eval.ts:108-117`)와 역행한다.
- max(80) 이후 남는 `llm-unavailable`은 거의 진짜 인프라 다운뿐이라,
  `predicted:true`로 매핑하면 인프라 장애를 양성 예측으로 오집계한다.

## 4. 변경 (3곳)

### 4-1. `classify-thread.ts` — 스키마 한도 완화 + 스키마 export

```ts
// before
const LlmResponseSchema = z.object({
  ...
  reason: z.string().min(1).max(40),
});
// after
export const LlmResponseSchema = z.object({  // export 추가 (4-2 직접 테스트용)
  ...
  reason: z.string().min(1).max(80),
});
```

프롬프트(SYSTEM_PROMPT의 "한국어 1줄 40자 이내")는 변경하지 않는다.
production 변경은 이 파일 1곳뿐(한도 80 + 스키마 export).

### 4-2. CI 회귀 가드 — 스키마 직접 단위 테스트 (핵심)

영어 fixture는 on-prem Layer 2(`pnpm eval:llm`)에서만 동작하고, CI(`pnpm test`)는
deterministic만 돌고 LLM을 안 부른다. 따라서 이 버그의 **지속적 회귀 가드가
CI에 없다**. 스키마 직접 단위 테스트가 진짜 회귀 가드다.

> **이 버그의 단위는 `classifyWithLLM`이 아니라 `LlmResponseSchema` 그 자체다.**
> Zod 검증은 게이트웨이 내부(`@krdn/llm-gateway`의 `runner/index.js`,
> `tryParseAndValidate(result.text, schema)`)에서 *앱이 넘긴 스키마*로 수행된다.
> 따라서 `analyzeStructured`를 mock하면 검증 자체가 사라져 max(40)이든 max(80)이든
> 똑같이 통과 — **mock 접근으로는 이 버그를 재현·가드할 수 없다.** 스키마를 직접
> 친다(게이트웨이·mock·LLM 없이 순수).

- 위치: `apps/dashboard/tests/llm-classify-thread-schema.test.ts` (신규, 순수 단위)
- 핵심 케이스(RED→GREEN): 60자 영어 reason 객체가
  `LlmResponseSchema.safeParse(...).success === true` 인지.
  ```ts
  expect(LlmResponseSchema.safeParse({
    needs_reply: true, severity: "high",
    reason: "Sender explicitly asks for a decision on the Q3 budget plan", // ~60자
  }).success).toBe(true);
  ```
- 보조 케이스(상한 고정): 81자 reason은 여전히 거부(`success === false`)되어
  한도가 무한이 아님을 못 박음.

순수 safeParse라 게이트웨이·DB·LLM 의존 없이 `pnpm test`(CI)에서 돈다.

### 4-3. `fixtures/reply-needed.json` — 영어 케이스 (이미 존재, 변경 불필요)

기존 fixture에 영어 케이스가 이미 충분히 있다(A: `r-A-deadline-en`,
`r-A-approval-en`, `r-A-question-en` / B: `r-B-implicit-en`, `r-B-soft-en`,
`r-B-vague-en` / C: `r-C-promo-action-en`, `r-C-webinar-en`, `r-C-promo-question-en`).
**fixture 추가는 불필요하다.** 이 영어 케이스들이 max(80) 수정 후 Layer 2
(`pnpm eval:llm`)에서 skip 없이 정상 집계되는지 확인하는 게 4-4의 일부다.

### 4-4. `thresholds.json` — replyLlm 임계치 보정 (Layer 2 run 이후)

max(80) 수정 후 `pnpm eval:llm`을 1회 실행해 영어 케이스 포함 깨끗한
precision/recall 측정값을 얻고, `replyLlm.precision`/`replyLlm.recall`을
**측정값 − 마진**으로 보정한다(현재 null).

> cli-proxy(`192.168.0.5:8317`) 접근성은 확인됨(401 = 서버 생존, 인증만 필요).
> `.env`에 `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY` 설정됨. Layer 2 run 가능.
> 단, run이 환경 사정으로 불가하면 `replyLlm`은 null로 남기고 "임계치 미보정"으로
> 정직하게 기록한다(루프 완전 닫힘은 그 경우 미달성).

## 5. 검증 흐름

1. `pnpm test` — 스키마 단위 테스트 GREEN (CI 회귀 가드). 60자 영어 reason →
   `safeParse.success === true`, 81자 → `false` 단언.
2. `cd apps/dashboard && pnpm typecheck && pnpm lint`
3. `pnpm eval:llm` — Layer 2 실 Haiku run. 영어 케이스가 skip 없이 정상 집계되는지,
   replyLlm precision/recall 측정값 확인.
4. `thresholds.json`의 `replyLlm` 보정.

## 6. 자가 치유 (마이그레이션 불필요)

기존에 fallback으로 잘못 flag된 영어 스레드는 다음 poll-gmail 주기에 재분류된다.

- LLM이 `no-reply`로 판정하면 `classifyThread`가 row를 삭제(`classifyThread.ts:73-76`).
- `needs-reply`면 upsert로 갱신.
- `setWhere userAction <> 'replied'`가 사용자가 이미 처리한 행은 보호.

별도 DB 마이그레이션·백필 불필요.

## 7. TDD 구조

`pnpm test`에서 도는 4-2의 스키마 직접 단위 테스트가 RED→GREEN의 중심이다:

1. **RED**: `max(40)` 상태에서 60자 영어 reason →
   `LlmResponseSchema.safeParse(...).success === false` → `true` 단언 실패.
2. **GREEN**: `max(40)` → `max(80)` → 60자 reason `success === true` → 통과.
3. 81자 거부 케이스(`success === false`)가 한도의 상한을 고정.
