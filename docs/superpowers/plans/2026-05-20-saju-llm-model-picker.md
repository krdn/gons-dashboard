# Saju LLM Model Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사주 프로필 페이지(lifetime + yearly + monthly)의 LLM narrative 분석을 Claude / Codex / Gemini 중에서 사용자가 선택할 수 있게 한다. URL search param `?model=...`으로 선택 상태 표현, 모델별 독립 캐시 유지.

**Architecture:** 단일 `ANTHROPIC_BASE_URL` 프록시가 model ID 문자열로 백엔드 분기. modelId는 URL → page(RSC) → widget(RSC) → tabs(client) → fetch URL `?model=` → API route → `getOrBuild*Narrative(...modelId)` → `anthropic.messages.create({ model: modelId })` 까지 명시 전파. daily(cron 정책)는 v1 범위 외.

**Tech Stack:** Next.js 16 App Router (RSC + client component), TypeScript, Anthropic SDK, Drizzle ORM, Zod, vitest. FSD slice 구조.

**Spec:** `docs/superpowers/specs/2026-05-20-saju-llm-model-picker-design.md`

---

## File Map

### 신규 파일

| 경로 | 책임 |
|------|------|
| `apps/dashboard/src/shared/lib/llm/saju-model-registry.ts` | 3종 모델 키/ID/라벨 registry + `parseSajuModelKey` |
| `apps/dashboard/src/shared/lib/llm/saju-model-registry.test.ts` | registry/parser unit test |
| `apps/dashboard/src/features/saju-model-picker/index.ts` | barrel export |
| `apps/dashboard/src/features/saju-model-picker/ui/SajuModelPicker.tsx` | client tab UI, `router.replace` 로 URL 갱신 |
| `apps/dashboard/src/features/saju-model-picker/ui/SajuModelPicker.test.tsx` | picker UI test |

### 수정 파일

| 경로 | 변경 |
|------|------|
| `apps/dashboard/src/shared/config/env.ts` | `SAJU_LLM_MODEL_CLAUDE/CODEX/GEMINI` 3개 추가 |
| `apps/dashboard/src/features/saju-lifetime-tri/api/narrative-server.ts` | `getOrBuildNarrative` 에 `modelId` 인자 추가 |
| `apps/dashboard/src/features/saju-yearly-tri/api/narrative-server.ts` | `getOrBuildYearlyNarrative` 에 `modelId` 인자 추가 |
| `apps/dashboard/src/features/saju-monthly-tri/api/narrative-server.ts` | `getOrBuildMonthlyNarrative` 에 `modelId` 인자 추가 |
| `apps/dashboard/src/app/api/saju/lifetime/[profileId]/narrative/route.ts` | `?model=` 파싱, 전달 |
| `apps/dashboard/src/app/api/saju/yearly/[profileId]/narrative/route.ts` | `?model=` 파싱, 전달 |
| `apps/dashboard/src/app/api/saju/monthly/[profileId]/narrative/route.ts` | `?model=` 파싱, 전달 |
| `apps/dashboard/src/features/saju-lifetime-tri/ui/LifetimeFrameCard.tsx` | `modelId` prop, fetch URL 쿼리 부착 |
| `apps/dashboard/src/features/saju-yearly-tri/ui/TriYearlyTabs.tsx` | `modelId` prop 받아 child 로 전달 |
| `apps/dashboard/src/features/saju-yearly-tri/ui/YearlyFrameView.tsx` | `modelId` prop, fetch URL 쿼리 부착 |
| `apps/dashboard/src/features/saju-monthly-tri/ui/TriMonthlyTabs.tsx` | `modelId` prop 받아 child 로 전달 |
| `apps/dashboard/src/features/saju-monthly-tri/ui/MonthlyFrameView.tsx` | `modelId` prop, fetch URL 쿼리 부착 |
| `apps/dashboard/src/widgets/saju-tri-lifetime/ui/SajuTriLifetime.tsx` | `modelId` prop, `LifetimeFrameCard` 에 전달 |
| `apps/dashboard/src/widgets/saju-tri-yearly/ui/SajuTriYearly.tsx` | `modelId` prop, `TriYearlyTabs` 에 전달 |
| `apps/dashboard/src/widgets/saju-tri-monthly/ui/SajuTriMonthly.tsx` | `modelId` prop, `TriMonthlyTabs` 에 전달 |
| `apps/dashboard/src/app/fortune/[profileId]/page.tsx` | `searchParams` 파싱, picker 마운트, 3 위젯에 `modelId` 전달 |
| `.env.example` | 새 env 변수 3개 예시 추가 |

---

## Commit 구성

- **Commit 1 (Tasks 1~3)** — Foundation: env + registry + unit test
- **Commit 2 (Tasks 4~7)** — narrative-server 인자화 + API route 파싱
- **Commit 3 (Tasks 8~13)** — UI: picker + 3 위젯 + 3 client tab 전파
- **Commit 4 (Task 14)** — `.env.example` 갱신

---

## Task 1: env.ts 에 3종 모델 ID 환경변수 추가

**Files:**
- Modify: `apps/dashboard/src/shared/config/env.ts`

- [ ] **Step 1: env.ts 의 zod schema 에 3개 변수 추가**

`SAJU_LLM_MODEL` 정의(line 32) **바로 아래**에 다음을 삽입:

```typescript
  // 사주 narrative 모델 선택 (v0.3.2) — 3종 백엔드별 모델 ID
  // 프록시(ANTHROPIC_BASE_URL=:8317)가 model 문자열을 보고 Claude/Codex/Gemini로 라우팅.
  SAJU_LLM_MODEL_CLAUDE: z.string().default("claude-opus-4-7"),
  SAJU_LLM_MODEL_CODEX: z.string().default("gpt-5-codex"),
  SAJU_LLM_MODEL_GEMINI: z.string().default("gemini-2.5-pro"),
```

- [ ] **Step 2: 타입체크**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS. env 객체가 새 키 3개를 노출.

- [ ] **Step 3: stage (commit은 Task 3 끝에 통합)**

```bash
git add apps/dashboard/src/shared/config/env.ts
```

---

## Task 2: saju-model-registry.ts 신규 작성

**Files:**
- Create: `apps/dashboard/src/shared/lib/llm/saju-model-registry.ts`

- [ ] **Step 1: 파일 작성**

```typescript
// 사주 narrative 분석에 사용할 LLM 모델 선택 registry (v0.3.2).
//
// 정책 (spec 2026-05-20):
//  - 단일 ANTHROPIC_BASE_URL 프록시가 model ID 문자열로 백엔드(Claude/Codex/Gemini) 분기
//  - UI 는 키(claude|codex|gemini)만 다루고, 실제 모델 ID는 env 에서 주입
//  - parseSajuModelKey 는 never throw — 잘못된 URL 입력 시 'claude' 로 폴백
import "server-only";
import { env } from "@/shared/config/env";

export const SAJU_MODEL_KEYS = ["claude", "codex", "gemini"] as const;
export type SajuModelKey = (typeof SAJU_MODEL_KEYS)[number];

export interface SajuModelInfo {
  id: string;
  label: string;
  vendor: string;
  description: string;
}

export const SAJU_MODEL_REGISTRY: Record<SajuModelKey, SajuModelInfo> = {
  claude: {
    id: env.SAJU_LLM_MODEL_CLAUDE,
    label: "Claude Opus 4.7",
    vendor: "Anthropic",
    description: "Anthropic Claude Opus 4.7 — 기본 모델, narrative schema 준수도 높음",
  },
  codex: {
    id: env.SAJU_LLM_MODEL_CODEX,
    label: "Codex (GPT-5)",
    vendor: "OpenAI",
    description: "OpenAI Codex (GPT-5 기반) — 비교 분석용 대안 모델",
  },
  gemini: {
    id: env.SAJU_LLM_MODEL_GEMINI,
    label: "Gemini 2.5 Pro",
    vendor: "Google",
    description: "Google Gemini 2.5 Pro — 비교 분석용 대안 모델",
  },
};

export const DEFAULT_SAJU_MODEL_KEY: SajuModelKey = "claude";

/**
 * URL search param 으로 들어온 raw 값을 안전하게 SajuModelKey 로 정규화.
 * Never throws — 잘못된 입력은 DEFAULT_SAJU_MODEL_KEY 로 폴백.
 */
export function parseSajuModelKey(raw: unknown): SajuModelKey {
  if (typeof raw !== "string") return DEFAULT_SAJU_MODEL_KEY;
  return (SAJU_MODEL_KEYS as readonly string[]).includes(raw)
    ? (raw as SajuModelKey)
    : DEFAULT_SAJU_MODEL_KEY;
}
```

- [ ] **Step 2: 타입체크**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: stage**

```bash
git add apps/dashboard/src/shared/lib/llm/saju-model-registry.ts
```

---

## Task 3: registry unit test (TDD — Red → Green → Commit)

**Files:**
- Create: `apps/dashboard/src/shared/lib/llm/saju-model-registry.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
import { describe, expect, it } from "vitest";
import {
  SAJU_MODEL_KEYS,
  SAJU_MODEL_REGISTRY,
  DEFAULT_SAJU_MODEL_KEY,
  parseSajuModelKey,
} from "./saju-model-registry";

describe("SAJU_MODEL_KEYS", () => {
  it("contains exactly claude, codex, gemini", () => {
    expect(SAJU_MODEL_KEYS).toEqual(["claude", "codex", "gemini"]);
  });
});

describe("SAJU_MODEL_REGISTRY", () => {
  it("has all three keys with non-empty id and label", () => {
    for (const key of SAJU_MODEL_KEYS) {
      const info = SAJU_MODEL_REGISTRY[key];
      expect(info.id).toBeTruthy();
      expect(info.label).toBeTruthy();
      expect(info.vendor).toBeTruthy();
    }
  });
});

describe("DEFAULT_SAJU_MODEL_KEY", () => {
  it("is 'claude'", () => {
    expect(DEFAULT_SAJU_MODEL_KEY).toBe("claude");
  });
});

describe("parseSajuModelKey", () => {
  it.each(["claude", "codex", "gemini"] as const)(
    "returns same key for valid input %s",
    (input) => {
      expect(parseSajuModelKey(input)).toBe(input);
    },
  );

  it.each([undefined, null, "", "invalid", "CLAUDE", "openai", {}, [], 42, true])(
    "returns DEFAULT_SAJU_MODEL_KEY for invalid input %p",
    (input) => {
      expect(parseSajuModelKey(input)).toBe(DEFAULT_SAJU_MODEL_KEY);
    },
  );
});
```

- [ ] **Step 2: 테스트 실행**

Run: `cd apps/dashboard && pnpm test src/shared/lib/llm/saju-model-registry.test.ts -- --run`
Expected: 모든 테스트 PASS.

- [ ] **Step 3: 전체 검증**

Run:
```bash
cd apps/dashboard && pnpm typecheck && pnpm lint
```
Expected: 모두 PASS.

- [ ] **Step 4: Commit 1**

```bash
git add apps/dashboard/src/shared/lib/llm/saju-model-registry.test.ts
git commit -m "$(cat <<'EOF'
feat(saju): LLM 모델 선택 foundation — env 변수 + registry

3종 narrative 모델(Claude/Codex/Gemini) 키/ID 매핑 registry 와
URL 파싱 헬퍼 parseSajuModelKey 추가. env 에 모델 ID 3쌍 추가.

다음 commit 에서 narrative-server / API route / UI 가 이 registry 를 사용한다.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: lifetime narrative-server 에 modelId 인자 추가

**Files:**
- Modify: `apps/dashboard/src/features/saju-lifetime-tri/api/narrative-server.ts`

- [ ] **Step 1: 파일 구조 확인**

먼저 파일의 `MODEL_ID` 상수 위치, retry helper 이름, `getOrBuildNarrative` 의 정확한 시그니처를 확인:

Run: `grep -n "MODEL_ID\|callLlm\|getOrBuildNarrative\|env\\." apps/dashboard/src/features/saju-lifetime-tri/api/narrative-server.ts`

확인할 점:
- `const MODEL_ID = env.SAJU_LLM_MODEL` 줄 번호
- retry helper 함수 이름
- `getOrBuildNarrative` 의 현재 인자 목록

- [ ] **Step 2: retry helper 시그니처에 modelId 인자 추가**

retry helper (예: `callLlmAndParseWithRetry`) 의 마지막 인자로 `modelId: string` 추가. 함수 본문에서 `anthropic.messages.create({ model: MODEL_ID, ... })` 를 `model: modelId` 로 변경.

```typescript
async function callLlmAndParseWithRetry(
  school: NarrativeSchool,
  systemPrompt: string,
  baseUserContent: string,
  modelId: string,  // ← 추가
): Promise<NarrativeOutput> {
  // ... 기존 로직
  const response = await anthropic.messages.create({
    model: modelId,  // ← MODEL_ID → modelId
    max_tokens: MAX_NARRATIVE_TOKENS,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });
  // ...
}
```

- [ ] **Step 3: getOrBuildNarrative 시그니처 변경**

```typescript
export async function getOrBuildNarrative(
  profileId: string,
  school: NarrativeSchool,
  frame: LifetimeFrame,
  modelId: string,  // ← 추가
): Promise<LifetimeNarrativeResult> {
  // 함수 본문 안의 `MODEL_ID` 참조를 모두 `modelId` 로 교체
  // retry helper 호출 시 modelId 를 마지막 인자로 전달
}
```

- [ ] **Step 4: const MODEL_ID 제거 + env import 정리**

`const MODEL_ID = env.SAJU_LLM_MODEL;` 줄 삭제.

Run: `grep -n "env\\." apps/dashboard/src/features/saju-lifetime-tri/api/narrative-server.ts`
- 매치 없음 → `import { env } from "@/shared/config/env";` 삭제
- 매치 있음 → import 유지

- [ ] **Step 5: 타입체크 — 호출부 에러 확인**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: **호출부에서 타입 에러 발생 정상**:

```
src/app/api/saju/lifetime/[profileId]/narrative/route.ts
  Expected 4 arguments, but got 3.
```

이 에러는 Task 5 에서 해결.

- [ ] **Step 6: stage (commit은 Task 7 끝에 통합)**

```bash
git add apps/dashboard/src/features/saju-lifetime-tri/api/narrative-server.ts
```

---

## Task 5: lifetime API route 에 ?model= 쿼리 파싱

**Files:**
- Modify: `apps/dashboard/src/app/api/saju/lifetime/[profileId]/narrative/route.ts`

- [ ] **Step 1: import + 핸들러 시그니처 확인**

Run: `grep -n "import\|export async function\|getOrBuildNarrative" apps/dashboard/src/app/api/saju/lifetime/[profileId]/narrative/route.ts`

확인: 현재 `request: Request` 매개변수가 핸들러에 있는지, `getOrBuildNarrative` 호출 라인.

- [ ] **Step 2: registry import 추가**

기존 import 섹션에 추가:

```typescript
import {
  SAJU_MODEL_REGISTRY,
  parseSajuModelKey,
} from "@/shared/lib/llm/saju-model-registry";
```

- [ ] **Step 3: request 매개변수 + 쿼리 파싱**

핸들러 signature 에 `request: Request` 가 없으면 추가:

```typescript
export async function GET(
  request: Request,
  { params }: { params: Promise<{ profileId: string }> },
) {
```

(`request: NextRequest` 인 경우는 그대로 두고 `request.nextUrl.searchParams` 사용.)

`getOrBuildNarrative` 호출 **직전**에 추가:

```typescript
    const url = new URL(request.url);
    const modelKey = parseSajuModelKey(url.searchParams.get("model"));
    const modelId = SAJU_MODEL_REGISTRY[modelKey].id;
```

- [ ] **Step 4: getOrBuildNarrative 호출에 modelId 전달**

```typescript
    const result = await getOrBuildNarrative(profileId, school, frame, modelId);
```

- [ ] **Step 5: 타입체크**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: 이 파일의 에러는 사라짐. yearly/monthly 는 아직 에러 — Task 6 에서 해결.

- [ ] **Step 6: stage**

```bash
git add apps/dashboard/src/app/api/saju/lifetime/[profileId]/narrative/route.ts
```

---

## Task 6: yearly + monthly narrative-server + API route 동일 패턴

**Files:**
- Modify: `apps/dashboard/src/features/saju-yearly-tri/api/narrative-server.ts`
- Modify: `apps/dashboard/src/features/saju-monthly-tri/api/narrative-server.ts`
- Modify: `apps/dashboard/src/app/api/saju/yearly/[profileId]/narrative/route.ts`
- Modify: `apps/dashboard/src/app/api/saju/monthly/[profileId]/narrative/route.ts`

- [ ] **Step 1: yearly narrative-server 변경 — Task 4 동일 패턴**

retry helper `callYearlyLlmAndParseWithRetry` 에 `modelId: string` 마지막 인자 추가. `anthropic.messages.create({ model: modelId, ... })`.

`getOrBuildYearlyNarrative` 시그니처:

```typescript
export async function getOrBuildYearlyNarrative(
  profileId: string,
  school: NarrativeSchool,
  targetYear: number,
  frame: YearlyFrame,
  modelId: string,  // ← 추가
): Promise<YearlyNarrativeResult> {
```

내부 `MODEL_ID` 참조 → `modelId`. `const MODEL_ID = env.SAJU_LLM_MODEL` 제거. env import 정리.

- [ ] **Step 2: monthly narrative-server 변경 — 동일 패턴**

먼저 시그니처 확인:

Run: `grep -n "getOrBuildMonthlyNarrative\|MODEL_ID\|callMonthlyLlm\|env\\." apps/dashboard/src/features/saju-monthly-tri/api/narrative-server.ts`

retry helper 에 `modelId: string` 마지막 인자 추가, `anthropic.messages.create` 의 model 필드 변경.

`getOrBuildMonthlyNarrative` 의 현재 인자 목록을 정확히 확인 후, **마지막 위치에** `modelId: string` 추가:

```typescript
export async function getOrBuildMonthlyNarrative(
  profileId: string,
  school: NarrativeSchool,
  targetYear: number,
  targetMonth: number,
  frame: MonthlyFrame,
  modelId: string,  // ← 마지막 위치
): Promise<MonthlyNarrativeResult> {
```

(인자 목록 정확성 — 파일을 직접 열어 시그니처 복사 후 마지막에 `modelId` 만 추가.)

`MODEL_ID` 참조 → `modelId`. env import 정리.

- [ ] **Step 3: yearly API route 쿼리 파싱**

`apps/dashboard/src/app/api/saju/yearly/[profileId]/narrative/route.ts` 에 Task 5 동일 패턴:

1. registry import 추가
2. handler 에 `request: Request` 매개변수 (없으면) 추가
3. `getOrBuildYearlyNarrative` 호출 직전:

```typescript
    const url = new URL(request.url);
    const modelKey = parseSajuModelKey(url.searchParams.get("model"));
    const modelId = SAJU_MODEL_REGISTRY[modelKey].id;
```

4. 호출에 `modelId` 마지막 인자로 전달.

- [ ] **Step 4: monthly API route 쿼리 파싱**

`apps/dashboard/src/app/api/saju/monthly/[profileId]/narrative/route.ts` 에 Task 5 동일 패턴. 호출 마지막 인자로 `modelId` 전달.

- [ ] **Step 5: 전체 타입체크 통과**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: **PASS**. 3 narrative-server / 3 API route 모두 일치.

- [ ] **Step 6: stage**

```bash
git add apps/dashboard/src/features/saju-yearly-tri/api/narrative-server.ts \
        apps/dashboard/src/features/saju-monthly-tri/api/narrative-server.ts \
        apps/dashboard/src/app/api/saju/yearly/[profileId]/narrative/route.ts \
        apps/dashboard/src/app/api/saju/monthly/[profileId]/narrative/route.ts
```

---

## Task 7: Commit 2 — backend 인자화 통합 커밋

- [ ] **Step 1: 전체 검증**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: 둘 다 PASS.

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(saju): narrative-server 3종에 modelId 인자 전파

lifetime/yearly/monthly narrative-server 의 anthropic.messages.create 가
이제 호출자가 명시한 modelId 를 사용. API route 3개가 ?model= 쿼리스트링을
파싱해 SAJU_MODEL_REGISTRY 를 통해 정확한 모델 ID 로 변환 후 전달.

쿼리 누락 시 DEFAULT_SAJU_MODEL_KEY('claude') 폴백 — 기존 동작 보존.
daily(cron) 는 v1 범위 외, 변경 없음.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: SajuModelPicker UI 컴포넌트 신규 작성

**Files:**
- Create: `apps/dashboard/src/features/saju-model-picker/index.ts`
- Create: `apps/dashboard/src/features/saju-model-picker/ui/SajuModelPicker.tsx`

- [ ] **Step 1: barrel 작성**

```typescript
// apps/dashboard/src/features/saju-model-picker/index.ts
export { SajuModelPicker } from "./ui/SajuModelPicker";
```

- [ ] **Step 2: client component 작성**

```typescript
// apps/dashboard/src/features/saju-model-picker/ui/SajuModelPicker.tsx
"use client";

// 사주 narrative 분석 모델 선택 탭 (v0.3.2).
//
// URL search param ?model=<key> 갱신으로 페이지 전역 모델 선택을 표현.
// router.replace 사용 — 브라우저 히스토리 무한 추가 방지 + scroll 보존.
import { useRouter, useSearchParams } from "next/navigation";
import {
  SAJU_MODEL_KEYS,
  SAJU_MODEL_REGISTRY,
  type SajuModelKey,
} from "@/shared/lib/llm/saju-model-registry";

interface Props {
  selected: SajuModelKey;
}

export function SajuModelPicker({ selected }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleSelect = (key: SajuModelKey) => {
    if (key === selected) return;
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("model", key);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  return (
    <div
      role="tablist"
      aria-label="분석 모델 선택"
      className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] p-1 text-xs"
    >
      {SAJU_MODEL_KEYS.map((key) => {
        const info = SAJU_MODEL_REGISTRY[key];
        const isActive = key === selected;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isActive}
            title={info.description}
            onClick={() => handleSelect(key)}
            className={
              isActive
                ? "rounded-md bg-[var(--color-accent)] px-3 py-1.5 font-medium text-white"
                : "rounded-md px-3 py-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
            }
          >
            {info.label}
          </button>
        );
      })}
    </div>
  );
}
```

**참고:** `SAJU_MODEL_REGISTRY` 가 `server-only` import 를 포함하므로 client 에서 사용 가능한지 확인 필요. 만약 빌드 에러가 발생하면 registry 를 두 파일로 분리:
- `saju-model-registry.ts` (`server-only`, env 접근)
- `saju-model-registry-meta.ts` (client safe, KEYS/labels/parseSajuModelKey만)

picker 는 meta 파일을 import.

- [ ] **Step 3: server-only 충돌 점검 & 분리 (필요 시)**

Run: `cd apps/dashboard && pnpm build`
Expected:
- 성공 → 그대로 진행
- 실패 (`server-only` 가 client component 에서 호출됨) → registry 를 2개 파일로 분리:

  `apps/dashboard/src/shared/lib/llm/saju-model-registry-meta.ts` (client 안전):
  ```typescript
  export const SAJU_MODEL_KEYS = ["claude", "codex", "gemini"] as const;
  export type SajuModelKey = (typeof SAJU_MODEL_KEYS)[number];
  export const SAJU_MODEL_LABELS: Record<SajuModelKey, { label: string; vendor: string; description: string }> = {
    claude: { label: "Claude Opus 4.7", vendor: "Anthropic", description: "..." },
    codex: { label: "Codex (GPT-5)", vendor: "OpenAI", description: "..." },
    gemini: { label: "Gemini 2.5 Pro", vendor: "Google", description: "..." },
  };
  export const DEFAULT_SAJU_MODEL_KEY: SajuModelKey = "claude";
  export function parseSajuModelKey(raw: unknown): SajuModelKey {
    if (typeof raw !== "string") return DEFAULT_SAJU_MODEL_KEY;
    return (SAJU_MODEL_KEYS as readonly string[]).includes(raw)
      ? (raw as SajuModelKey)
      : DEFAULT_SAJU_MODEL_KEY;
  }
  ```

  `saju-model-registry.ts` 는 위 meta 를 re-export + env 기반 ID 매핑만 유지 (server-only).

  picker 는 meta 만 import.

  이 분리가 발생하면 Task 3 의 test 도 meta 파일을 대상으로 변경.

- [ ] **Step 4: 타입체크**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: stage**

```bash
git add apps/dashboard/src/features/saju-model-picker/index.ts \
        apps/dashboard/src/features/saju-model-picker/ui/SajuModelPicker.tsx
# (Step 3 에서 파일 분리했으면 saju-model-registry-meta.ts 도 add)
```

---

## Task 9: SajuModelPicker component test

**Files:**
- Create: `apps/dashboard/src/features/saju-model-picker/ui/SajuModelPicker.test.tsx`

- [ ] **Step 1: 테스트 인프라 확인**

Run: `grep -rn "@testing-library/react" apps/dashboard/package.json apps/dashboard/src/**/*.test.* 2>/dev/null | head -5`

- 매치 있음 → RTL 사용 가능, Step 2 진행
- 매치 없음 → 본 task 는 skip 하고 manual 검증 (Task 15) 으로 대체. plan 의 이 task 를 "SKIPPED — RTL not installed" 로 마킹.

- [ ] **Step 2: 테스트 작성 (RTL 가용 시)**

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SajuModelPicker } from "./SajuModelPicker";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => new URLSearchParams("model=claude"),
}));

describe("SajuModelPicker", () => {
  beforeEach(() => {
    replaceMock.mockClear();
  });

  it("renders all three model tabs", () => {
    render(<SajuModelPicker selected="claude" />);
    expect(screen.getByRole("tab", { name: /Claude/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Codex/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Gemini/ })).toBeInTheDocument();
  });

  it("marks selected tab with aria-selected=true", () => {
    render(<SajuModelPicker selected="codex" />);
    expect(screen.getByRole("tab", { name: /Codex/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("calls router.replace with new model on click", () => {
    render(<SajuModelPicker selected="claude" />);
    fireEvent.click(screen.getByRole("tab", { name: /Codex/ }));
    expect(replaceMock).toHaveBeenCalledWith(
      expect.stringContaining("model=codex"),
      { scroll: false },
    );
  });

  it("does not call replace when same tab clicked", () => {
    render(<SajuModelPicker selected="claude" />);
    fireEvent.click(screen.getByRole("tab", { name: /Claude/ }));
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 테스트 실행**

Run: `cd apps/dashboard && pnpm test src/features/saju-model-picker/ui/SajuModelPicker.test.tsx -- --run`
Expected: PASS.

- [ ] **Step 4: stage**

```bash
git add apps/dashboard/src/features/saju-model-picker/ui/SajuModelPicker.test.tsx
```

---

## Task 10: lifetime UI 체인 — modelId prop 전파

**Files:**
- Modify: `apps/dashboard/src/widgets/saju-tri-lifetime/ui/SajuTriLifetime.tsx`
- Modify: `apps/dashboard/src/features/saju-lifetime-tri/ui/LifetimeFrameCard.tsx`

- [ ] **Step 1: SajuTriLifetime RSC 에 modelId prop 추가**

`apps/dashboard/src/widgets/saju-tri-lifetime/ui/SajuTriLifetime.tsx`:

```typescript
interface Props {
  profileId: string;
  userId: string;
  modelId: string;
}

export async function SajuTriLifetime({ profileId, userId, modelId }: Props) {
```

JSX 안의 모든 `<LifetimeFrameCard ... />` 호출에 `modelId={modelId}` prop 추가.

- [ ] **Step 2: LifetimeFrameCard Props + fetch URL 변경**

`apps/dashboard/src/features/saju-lifetime-tri/ui/LifetimeFrameCard.tsx`:

Props interface 에 `modelId: string` 추가:

```typescript
interface Props {
  profileId: string;
  schoolKey: SchoolKey;
  frame: LifetimeFrame;
  modelId: string;
}

export function LifetimeFrameCard({ profileId, schoolKey, frame, modelId }: Props) {
```

기존 line 89 부근의 fetch URL 변경:

```typescript
        const response = await fetch(
          `/api/saju/lifetime/${profileId}/narrative?school=${schoolKey}&model=${encodeURIComponent(modelId)}`,
          { signal: controller.signal },
        );
```

`useEffect`/`useCallback` 의 의존성 배열에 `modelId` 추가. 정확한 위치는 파일 안의 기존 deps 배열에 한 entry 추가:

Run: `grep -n "useEffect\|useCallback\|}, \[" apps/dashboard/src/features/saju-lifetime-tri/ui/LifetimeFrameCard.tsx | head -5`

각 deps 배열의 fetch 가 의존하는 곳에 `modelId` 추가.

- [ ] **Step 3: 타입체크**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: `page.tsx` 에서 `SajuTriLifetime` 호출에 `modelId` 누락 에러. Task 13 에서 해결.

- [ ] **Step 4: stage**

```bash
git add apps/dashboard/src/widgets/saju-tri-lifetime/ui/SajuTriLifetime.tsx \
        apps/dashboard/src/features/saju-lifetime-tri/ui/LifetimeFrameCard.tsx
```

---

## Task 11: yearly UI 체인 — modelId prop 전파

**Files:**
- Modify: `apps/dashboard/src/widgets/saju-tri-yearly/ui/SajuTriYearly.tsx`
- Modify: `apps/dashboard/src/features/saju-yearly-tri/ui/TriYearlyTabs.tsx`
- Modify: `apps/dashboard/src/features/saju-yearly-tri/ui/YearlyFrameView.tsx`

- [ ] **Step 1: SajuTriYearly Props 확장**

```typescript
interface Props {
  profileId: string;
  userId: string;
  targetYear?: number;
  modelId: string;
}

export async function SajuTriYearly({ profileId, userId, targetYear, modelId }: Props) {
```

JSX `<TriYearlyTabs ... />` 호출에 `modelId={modelId}` 추가.

- [ ] **Step 2: TriYearlyTabs Props 확장 + 전달**

`apps/dashboard/src/features/saju-yearly-tri/ui/TriYearlyTabs.tsx`:

Props interface 에 `modelId: string` 추가. line 284 부근의 `<YearlyFrameView ... />` 에 `modelId={modelId}` 전달.

- [ ] **Step 3: YearlyFrameView Props + fetch URL**

`apps/dashboard/src/features/saju-yearly-tri/ui/YearlyFrameView.tsx`:

Props interface 에 `modelId: string` 추가. 내부 fetch URL을 변경:

```typescript
        const response = await fetch(
          `/api/saju/yearly/${profileId}/narrative?school=${schoolKey}&year=${targetYear}&model=${encodeURIComponent(modelId)}`,
          { signal: controller.signal },
        );
```

(현재 fetch URL 의 query 키 이름이 `school`/`year` 이 맞는지 파일을 열어 확인 후 그 위에 `&model=` 만 추가.)

useEffect/useCallback deps 에 `modelId` 추가.

- [ ] **Step 4: 타입체크**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: page.tsx 잔여 에러만. Task 13 에서 해결.

- [ ] **Step 5: stage**

```bash
git add apps/dashboard/src/widgets/saju-tri-yearly/ui/SajuTriYearly.tsx \
        apps/dashboard/src/features/saju-yearly-tri/ui/TriYearlyTabs.tsx \
        apps/dashboard/src/features/saju-yearly-tri/ui/YearlyFrameView.tsx
```

---

## Task 12: monthly UI 체인 — modelId prop 전파

**Files:**
- Modify: `apps/dashboard/src/widgets/saju-tri-monthly/ui/SajuTriMonthly.tsx`
- Modify: `apps/dashboard/src/features/saju-monthly-tri/ui/TriMonthlyTabs.tsx`
- Modify: `apps/dashboard/src/features/saju-monthly-tri/ui/MonthlyFrameView.tsx`

Task 11 의 yearly 패턴을 monthly 에 동일 적용.

- [ ] **Step 1: SajuTriMonthly Props 확장**

기존 Props 에 `modelId: string` 추가:

```typescript
interface Props {
  profileId: string;
  userId: string;
  modelId: string;
  // 기존 targetYear/targetMonth 등 유지
}
```

JSX `<TriMonthlyTabs ... />` 에 `modelId={modelId}` 추가.

- [ ] **Step 2: TriMonthlyTabs Props 확장 + 전달**

Props 에 `modelId: string` 추가. `<MonthlyFrameView ... modelId={modelId} />` 전달.

- [ ] **Step 3: MonthlyFrameView Props + fetch URL**

Props 에 `modelId: string` 추가. fetch URL 변경:

```typescript
        const response = await fetch(
          `/api/saju/monthly/${profileId}/narrative?school=${schoolKey}&year=${targetYear}&month=${targetMonth}&model=${encodeURIComponent(modelId)}`,
          { signal: controller.signal },
        );
```

(기존 URL 의 year/month 쿼리 키 확인 후 `&model=` 만 추가.)

useEffect/useCallback deps 에 `modelId` 추가.

- [ ] **Step 4: 타입체크**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: page.tsx 잔여 에러만. Task 13 에서 해결.

- [ ] **Step 5: stage**

```bash
git add apps/dashboard/src/widgets/saju-tri-monthly/ui/SajuTriMonthly.tsx \
        apps/dashboard/src/features/saju-monthly-tri/ui/TriMonthlyTabs.tsx \
        apps/dashboard/src/features/saju-monthly-tri/ui/MonthlyFrameView.tsx
```

---

## Task 13: fortune/[profileId]/page.tsx — searchParams + picker 마운트

**Files:**
- Modify: `apps/dashboard/src/app/fortune/[profileId]/page.tsx`

- [ ] **Step 1: import 추가**

파일 상단 import 섹션에 추가:

```typescript
import {
  SAJU_MODEL_REGISTRY,
  parseSajuModelKey,
} from "@/shared/lib/llm/saju-model-registry";
import { SajuModelPicker } from "@/features/saju-model-picker";
```

(만약 Task 8 Step 3 에서 registry 가 server-only 라 client picker 가 meta 를 별도 import 한다면, page.tsx 는 server-only 가 가능하므로 메인 registry 그대로 import.)

- [ ] **Step 2: Props 타입 확장**

기존:

```typescript
type Props = { params: Promise<{ profileId: string }> };
```

변경:

```typescript
type Props = {
  params: Promise<{ profileId: string }>;
  searchParams: Promise<{ model?: string | string[] }>;
};
```

- [ ] **Step 3: handler 시그니처 + modelKey/modelId 계산**

```typescript
export default async function SajuDetailPage({ params, searchParams }: Props) {
  const { profileId } = await params;
  const sp = await searchParams;
  const modelKey = parseSajuModelKey(
    Array.isArray(sp.model) ? sp.model[0] : sp.model,
  );
  const modelId = SAJU_MODEL_REGISTRY[modelKey].id;

  const session = await auth();
  // ... 기존 코드 계속
```

- [ ] **Step 4: header 영역에 picker 마운트**

기존:

```typescript
<SajuDetailHeader profile={profile} />
```

변경:

```typescript
<div className="mb-6 flex items-start justify-between gap-4">
  <SajuDetailHeader profile={profile} />
  <SajuModelPicker selected={modelKey} />
</div>
```

(`SajuDetailHeader` 자체에 mb-N margin 이 이미 있을 수 있음 — manual 검증 (Task 15) 단계에서 확인 후 필요 시 조정.)

- [ ] **Step 5: 3 위젯에 modelId 전달**

기존 3 위젯 호출:

```typescript
<SajuTriLifetime profileId={profileId} userId={session.user.id} />
<SajuTriYearly profileId={profileId} userId={session.user.id} />
<SajuTriMonthly profileId={profileId} userId={session.user.id} />
```

변경:

```typescript
<SajuTriLifetime profileId={profileId} userId={session.user.id} modelId={modelId} />
<SajuTriYearly profileId={profileId} userId={session.user.id} modelId={modelId} />
<SajuTriMonthly profileId={profileId} userId={session.user.id} modelId={modelId} />
```

- [ ] **Step 6: 전체 검증**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: **모두 PASS**.

- [ ] **Step 7: 모든 unit/component test 재실행**

Run:
```bash
cd apps/dashboard && pnpm test src/shared/lib/llm/saju-model-registry.test.ts src/features/saju-model-picker/ui/SajuModelPicker.test.tsx -- --run
```
Expected: 둘 다 PASS.

- [ ] **Step 8: stage**

```bash
git add apps/dashboard/src/app/fortune/[profileId]/page.tsx
```

- [ ] **Step 9: Commit 3**

```bash
git commit -m "$(cat <<'EOF'
feat(saju): LLM 모델 선택 picker UI + 3 위젯 전파

페이지 헤더 우측에 SajuModelPicker 마운트. URL ?model=<key> 로 선택 상태
표현. lifetime/yearly/monthly 3 위젯 → client tab → fetch URL ?model= 까지
modelId 명시 전파. 캐시 키 model_id 컬럼이 자연 분리 키.

기본 모델 claude — 잘못된 URL 값은 안전 폴백.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: .env.example 갱신

**Files:**
- Modify: `.env.example` (root 또는 `apps/dashboard/.env.example`)

- [ ] **Step 1: 실제 .env.example 위치 확인**

Run: `find . -maxdepth 3 -name ".env.example" -not -path "./node_modules/*"`

발견된 경로 사용. 양쪽에 있다면 둘 다 갱신.

- [ ] **Step 2: 새 변수 3개 추가**

파일의 기존 `SAJU_LLM_MODEL=` 줄 부근에 추가:

```
# 사주 narrative 모델 선택 (v0.3.2) — 프록시가 model 문자열로 백엔드 라우팅
SAJU_LLM_MODEL_CLAUDE=claude-opus-4-7
SAJU_LLM_MODEL_CODEX=gpt-5-codex
SAJU_LLM_MODEL_GEMINI=gemini-2.5-pro
```

- [ ] **Step 3: stage + Commit 4**

```bash
git add .env.example
# 양쪽 경로 있으면 함께 add: git add apps/dashboard/.env.example

git commit -m "$(cat <<'EOF'
docs(env): 사주 narrative 3종 모델 ID env 변수 예시 추가

SAJU_LLM_MODEL_CLAUDE/CODEX/GEMINI — env.ts 의 .default(...) 가 fallback 을
제공하므로 새 배포에서 별도 설정 없이도 동작.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: 로컬 브라우저 manual 검증

**Files:** (검증만, 변경 없음)

- [ ] **Step 1: dev 서버 기동**

Run: `cd apps/dashboard && pnpm dev`
Expected: `http://localhost:3020` 시작.

- [ ] **Step 2: 사주 프로필 페이지 방문**

`http://localhost:3020/fortune/<existing-profile-id>` (기존 테스트 프로필).

확인:
- 페이지 헤더 우측에 Claude / Codex / Gemini 3 탭 표시
- Claude 탭 활성 (default)
- 3 위젯 (lifetime/yearly/monthly) 정상 렌더

- [ ] **Step 3: Codex 탭 클릭**

확인:
- URL `?model=codex` 로 변경
- 페이지 스크롤 위치 유지
- 3 위젯 client tab 이 새 modelId 로 fetch 재실행
- **주의:** 로컬에서 프록시 192.168.0.5:8317 접근 불가하면 Codex/Gemini 호출 실패 가능. error 카드 정상 표시 확인.

- [ ] **Step 4: 잘못된 URL 폴백**

`?model=invalid_xxx` 직접 입력 → 페이지 정상, Claude 탭 활성.

- [ ] **Step 5: 브라우저 뒤로가기**

`?model=codex` → 뒤로 → 이전 상태 복원.

- [ ] **Step 6: 결과 기록**

PR description 의 test plan checklist 갱신.

---

## Task 16: PR 생성

**Files:** (PR 메타데이터)

- [ ] **Step 1: 브랜치 push**

Run: `git push -u origin HEAD`

- [ ] **Step 2: PR 생성**

```bash
gh pr create --title "feat(saju): LLM 모델 선택(Claude/Codex/Gemini) — v0.3.2" --body "$(cat <<'EOF'
## Summary

- 사주 프로필 페이지(lifetime + yearly + monthly)의 narrative 분석에 사용할 LLM 모델을 사용자가 선택 가능
- URL search param ?model=claude|codex|gemini 로 페이지 전역 상태 표현
- 모델별 독립 캐시 (기존 model_id 컬럼 활용, 마이그레이션 불필요)
- daily(cron) 는 v1 범위 외, 변경 없음

Spec: docs/superpowers/specs/2026-05-20-saju-llm-model-picker-design.md
Plan: docs/superpowers/plans/2026-05-20-saju-llm-model-picker.md

## Commits

1. feat(saju): LLM 모델 선택 foundation — env 변수 + registry
2. feat(saju): narrative-server 3종에 modelId 인자 전파
3. feat(saju): LLM 모델 선택 picker UI + 3 위젯 전파
4. docs(env): 사주 narrative 3종 모델 ID env 변수 예시 추가

## Test plan

- [x] pnpm typecheck PASS
- [x] pnpm lint PASS
- [x] pnpm test saju-model-registry.test.ts PASS
- [x] pnpm test SajuModelPicker.test.tsx PASS (RTL 가용 시)
- [ ] 로컬 브라우저: Claude 탭 활성 default
- [ ] 로컬 브라우저: Codex/Gemini 탭 전환 시 URL ?model= 갱신
- [ ] 로컬 브라우저: ?model=invalid 폴백 정상
- [ ] 운영 배포 후: Codex/Gemini 실제 호출 가능성 검증 (별도 hotfix 가능)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: PR URL 출력 + 사용자에게 공유**

Run: `gh pr view --json url -q .url`

---

## Phase 4 (PR 머지 후 운영 검증) — 별도 작업

1. 운영 서버 (`192.168.0.5`) 에서 Codex 모델 호출 성공 — 응답 schema 정상 여부
2. Gemini 호출 동일 검증
3. 모델별 zod schema 검증 실패율 모니터링
4. 회귀 시:
   - `SAJU_MODEL_KEYS` 에서 해당 모델 제외 → picker 에서 사라짐
   - env default 의 모델 ID 문자열 정정 후 재배포

---

## 자체 검증 체크리스트 (plan 작성자 self-review)

| Spec 항목 | 다루는 Task |
|----------|------------|
| §3 modelKey/modelId 전파 경로 | Task 4~13 전체 |
| §4.1 신규 파일 (registry + picker) | Task 2, 8 |
| §4.2 수정 파일 전체 | Task 1, 4, 5, 6, 10, 11, 12, 13 |
| §5 UI 위치/형태 | Task 8 (picker), Task 13 (page 마운트) |
| §6.2 parseSajuModelKey never-throw | Task 2 (구현), Task 3 (테스트) |
| §6.3 modelId 명시 전파 불변식 | Task 4~13 일관 적용 |
| §7 Layer 1 URL 파싱 폴백 | Task 2, 3, 13 |
| §7 Layer 3 프록시 unknown provider | 기존 narrative-server error path 유지 |
| §7 Layer 4 zod retry | 기존 callXxxLlmAndParseWithRetry 패턴 유지 + modelId 인자 전달 |
| §9.1 unit test | Task 3 |
| §9.2 component test | Task 9 (RTL 가용 시) |
| §9.4 manual 검증 | Task 15 |
| §10 단일 PR + 단계별 커밋 | Task 3, 7, 13, 14 의 commit |
| §11 롤백 — picker 숨김 | `SAJU_MODEL_KEYS` 한 줄 변경 — 별도 task 불필요 |

**스펙 미커버 항목**: 없음.
**Placeholder 스캔**: 없음.
**타입 일관성**: `modelId: string` — narrative-server 호출에서 일관되게 마지막 인자. `SajuModelKey` / `parseSajuModelKey` 이름 일관.
