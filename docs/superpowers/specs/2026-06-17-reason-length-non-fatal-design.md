# 분류 reason/summary 길이가 verdict를 무효화하는 문제 수정 (#145) — 설계 문서

작성일: 2026-06-17
브랜치: (구현 시 `fix/reason-length-non-fatal`)
범위: 답장·중요 분류기의 reason류 텍스트 필드 길이 제약이 분류 verdict 전체를 무효화하는 구조적 버그 수정

## 1. 배경 & 문제

분류기의 Zod 스키마에서 `reason`/`summary`/`rationale`은 **UI 표시·디버깅용 부수 텍스트**인데, 그 길이 제약(`.max(80)`/`.max(200)`)이 게이트웨이의 `schema.safeParse` 실패를 유발해 **분류 verdict(`needs_reply`/`severity`/`category`/`importance`) 전체를 무효화**한다.

게이트웨이 동작 (`@krdn/llm-gateway` `runner/index.js`의 `tryParseAndValidate`):
- `schema.safeParse(parsed)` 실패 시 `null` 반환 → step1 실패 → step2 변환 시도 → step2도 실패하면 `analyzeStructured`가 throw.

### 두 트랙의 영향 (다른 실패 모드, 같은 근본 원인)

- **답장 트랙** (`classify-thread.ts`, `reason.max(80)`): 검증 실패 → `classifyWithLLM`이 `llm-unavailable` → `classifyThread`가 deterministic fallback으로 **잘못 flag 유지 (FP)**.
- **중요 트랙** (`classify-important.ts`, `summary.max(200)`/`rationale.max(200)`): 검증 실패 → `analyzeStructured` throw → `classifyImportant`가 **`skipped-llm-error`** → 그 메일은 중요로 **분류 안 됨 (FN/놓침)**.

### 관측 증거

PR #146으로 복구된 eval Layer 2 첫 run (`reports/2026-06-17.json`)에서 `reason: at most 80 character(s)` Zod 실패 6회, 그 중 2건은 게이트웨이 2단계 변환조차 실패해 skip. PR #144의 `max(40)→max(80)`은 개선이었으나 80자도 부족한 케이스가 다수 드러남.

## 2. 근본 스멜 & 해법 방향

"max를 더 올리기"는 같은 함정의 연장이다. `reason`은 부수 필드인데 그 길이가 핵심 verdict를 "전부 아니면 전무"로 무효화하는 게 문제. **길이 제약 자체를 제거**해 verdict가 reason 길이와 독립되게 한다. 프롬프트의 소프트 가이드("한국어 40자"/"최대 200자")는 유지해 reason 폭주를 막는다.

**대안 기각**:
- *truncate transform* (`.transform(s => s.slice(0,80))`): verdict는 살리지만 reason이 잘림. 제약 제거가 더 단순하고 DB가 text라 잘릴 이유도 없음.
- *호출자에서 reason 분리 검증*: `analyzeStructured` 호출 패턴 변경 + 두 분류기 재구조화. 복잡도 상승, YAGNI.

## 3. 변경 (4곳)

### 3-1. `classify-thread.ts` — reason max 제거

```ts
// before
reason: z.string().min(1).max(80),
// after
reason: z.string().min(1),
```

SYSTEM_PROMPT의 "한국어 1줄 40자 이내"는 유지 (소프트 가이드).

### 3-2. `classify-important.ts` — summary/rationale max 제거 + orphan 정리

```ts
// before
const SUMMARY_MAX = 200;
...
summary: z.string().max(SUMMARY_MAX),
rationale: z.string().max(200),
// after
summary: z.string(),
rationale: z.string(),
```

`const SUMMARY_MAX = 200`은 `.max()` 제거로 고아가 되므로 **삭제**한다 (이 변경이 만든 orphan → no-unused-vars 통과 위해 제거). 프롬프트의 "최대 200자" 소프트 가이드는 유지.

### 3-3. CI 회귀 테스트 — 스키마 직접 safeParse (PR #144 패턴)

스키마를 직접 `safeParse`하는 순수 단위 테스트 (게이트웨이·mock·LLM·DB 의존 없음 → `pnpm test` CI에서 동작).

**답장 트랙** (`tests/eval/llm-classify-thread-schema.test.ts` 수정):
- ⚠️ **PR #144가 추가한 "81자 reason은 거부한다 (`success === false`)" 케이스가 max 제거와 정면 충돌한다.** 이 케이스를 **반전**해야 한다 — 긴 reason(예: 200자)도 `success === true`로 수용.
- `classify-thread.ts:21-29`의 해당 `it` 블록을 "긴 reason도 수용한다" 단언으로 교체.

**중요 트랙** (`tests/eval/llm-classify-important-schema.test.ts` 신규):
- `classify-important.ts`의 응답 스키마(`ResponseSchema`)는 현재 직접 테스트가 없다 (기존 `classify-important-thread.test.ts`는 gateway mock이라 길이 검증을 안 탐). 스키마를 export하고 직접 테스트 신규 추가: 300자 summary/rationale가 `success === true`.

### 3-4. `ReplyBadges.tsx` — reason 뱃지 truncate

`ReplyBadges.tsx:44`가 `{reason}`을 `rounded-full border` 뱃지(pill)에 truncate 없이 렌더 → 긴 reason이 뱃지를 폭주시킬 수 있다. 뱃지 span에 `max-w` + `truncate`(또는 `line-clamp`) 추가.

중요 트랙 row(`ImportantEmailRow.tsx:90`)는 summary를 이미 `line-clamp-3`으로 표시하므로 **무변경**. rationale은 디버깅/eval용이라 UI 미표시.

## 4. DB / 자가 치유 (마이그레이션 불필요)

- `reply_needed.reason` = `text("reason").notNull()` (email.ts:55)
- `important_emails.summary` = `text("summary").notNull()` (email.ts:89)
- `important_emails.rationale` = `text("rationale").notNull()` (email.ts:90)

세 컬럼 모두 **text 타입** — max 제거해도 긴 텍스트 저장 시 DB 에러 없음. 마이그레이션 불필요. (email.ts:89의 "≤ 200자 한국어" 주석은 정확성을 위해 갱신 권장.)

기존에 fallback FP(답장)/skipped FN(중요)된 스레드는 다음 poll-gmail 주기에 재분류된다.

## 5. 검증 흐름

1. `pnpm test` — 스키마 직접 테스트 GREEN. 답장 충돌 케이스 반전 확인(긴 reason 수용), 중요 신규 테스트(300자 summary/rationale 수용).
2. `cd apps/dashboard && pnpm typecheck && pnpm lint` — `SUMMARY_MAX` orphan 제거로 no-unused-vars 통과.
3. 배포 시: #146(메타데이터)과 달리 **런타임 분류 동작 변경**이라 health/route뿐 아니라 분류가 여전히 도는지(새 이미지 grep / 다음 poll 결과)까지 검증.

## 6. TDD 구조 (inline)

3개 필드 `.max()` 삭제 + 테스트 반전·추가 + orphan 제거 + UI 한 줄 — 작은 변경이라 subagent 오케스트레이션 없이 **inline TDD**가 비례적:

1. **RED**: 답장 테스트 반전(200자 수용 단언) + 중요 신규 테스트(300자 수용) → 현재 max 제약이라 fail.
2. **GREEN**: 3개 필드 `.max()` 제거 + `SUMMARY_MAX` 삭제 + 스키마 export → pass.
3. UI truncate + typecheck/lint/test 전체 GREEN.

## 7. 범위 밖

- `reason: z.string().min(1)`의 빈 reason fatal 경로 — 관측된 적 없어 미수정.
