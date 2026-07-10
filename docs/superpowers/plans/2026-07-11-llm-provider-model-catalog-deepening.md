# LLM Provider Model Catalog Deepening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 메모·이메일 답장·사주가 동일한 공급사 모델 카탈로그 로더와 선택 파생 API를 사용하되 각 도메인의 기본값·필터·저장·표시 정책은 그대로 유지한다.

**Architecture:** Client-safe `provider-model-catalog.ts`가 선택지와 가용성을 순수 계산하고, 내부 `provider-model-catalog-loader.ts`가 정책 검증·분류·폴백을 담당하며 server-only `provider-model-catalog-server.ts`가 HTTP source를 결합한다. 메모·답장·사주는 작은 정책 adapter만 제공하며 DB 필드, URL 파라미터, UI 표시 순서는 변경하지 않는다.

**Tech Stack:** TypeScript 5, Next.js 16 App Router/Server Actions, React 19, Vitest 4, Testing Library, pnpm workspace

## Global Constraints

- 설계 기준은 `docs/superpowers/specs/2026-07-11-llm-provider-model-catalog-deepening-design.md`다.
- 공개 실행 API는 `deriveModelOptions(input)`와 `loadProviderModelCatalog(policy)` 두 개로 수렴시킨다.
- 프록시 timeout은 정확히 `3_000ms`, 요청 cache는 `"no-store"`다.
- timeout, 연결 실패, HTTP 비정상 응답, JSON 파싱 실패, 유효 모델이 없는 응답은 throw하지 않고 `source: "fallback"`으로 반환한다.
- 잘못된 정책과 `allow` predicate 예외는 fallback으로 숨기지 않고 throw한다.
- fallback snapshot의 가용성은 항상 `"unknown"`이며 호출을 차단하지 않는다.
- DB 스키마, 환경 변수 이름, URL의 `model`/`modelId`, 사용자 문구, Server Action 결과 유니온은 변경하지 않는다.
- `LLM_PROVIDER_KEYS`의 순서를 UI 순서로 사용하지 않는다. 메모·답장·사주는 기존 키 배열 순서를 유지한다.
- Client Component는 `provider-model-catalog-server.ts` 또는 `@/shared/lib/log`를 import하지 않는다.
- 신규 런타임 의존성을 추가하지 않는다.
- 각 작업은 failing test → 최소 구현 → passing test → 커밋 순서로 수행한다.

---

## File Map

### Shared core

- Modify: `apps/dashboard/src/shared/lib/llm/provider-model-catalog.ts` — 공통 타입, 모델 ID 검증, 추천/기타/가용성 파생
- Modify: `apps/dashboard/src/shared/lib/llm/provider-model-catalog.test.ts` — client-safe 공개 API 특성 테스트
- Create: `apps/dashboard/src/shared/lib/llm/provider-model-catalog-loader.ts` — 정책 검증·분류·폴백을 담당하는 server 내부 loader factory
- Create: `apps/dashboard/src/shared/lib/llm/provider-model-catalog-loader.test.ts` — in-memory source seam 특성 테스트
- Modify: `apps/dashboard/src/shared/lib/llm/provider-model-catalog-server.ts` — 정책 기반 카탈로그 로더와 HTTP source
- Create: `apps/dashboard/src/shared/lib/llm/provider-model-catalog-server.test.ts` — HTTP 실패 분류와 안전 로그 테스트

### Memo adapter and consumers

- Modify: `apps/dashboard/src/entities/memo/model/types.ts` — 공통 공급사·카탈로그 타입 alias와 기존 DB 선택 타입
- Modify: `apps/dashboard/src/entities/memo/model/model-recommendations.ts` — 메모 추천 규칙만 소유
- Modify: `apps/dashboard/src/entities/memo/model/model-recommendations.test.ts` — 메모 규칙 회귀 테스트
- Modify: `apps/dashboard/src/entities/memo/client.ts` — client-safe alias와 추천 규칙 export
- Modify: `apps/dashboard/src/entities/memo/server.ts` — server entrypoint alias 정리
- Replace: `apps/dashboard/src/features/memo-transform/lib/model-catalog.ts` — 환경 기본값을 공통 로더 정책으로 변환
- Modify: `apps/dashboard/src/features/memo-transform/lib/model-catalog.test.ts` — 얇은 adapter 정책 테스트
- Modify: `apps/dashboard/src/app/(dashboard)/memos/settings/page.tsx` — snapshot을 설정 UI에 전달
- Modify: `apps/dashboard/src/features/memo-preset-manage/ui/ModelSelectionFields.tsx` — 공통 선택 파생 사용
- Modify: `apps/dashboard/src/features/memo-preset-manage/ui/PresetSettings.tsx` — snapshot 전달
- Modify: `apps/dashboard/src/features/memo-preset-manage/ui/PresetEditor.tsx` — snapshot 전달
- Modify: `apps/dashboard/src/features/memo-preset-manage/ui/PresetSettings.test.tsx` — live/fallback 표시 회귀
- Modify: `apps/dashboard/src/features/memo-preset-manage/api/previewPresetAction.ts` — enum 가용성 계약 사용
- Modify: `apps/dashboard/src/features/memo-preset-manage/api/presetActions.test.ts` — unavailable/unknown 분기 회귀

### Email reply adapter and consumers

- Modify: `apps/dashboard/src/entities/email-settings/model/replyModel.ts` — snapshot 응답 타입과 기존 표시 순서 유지
- Modify: `apps/dashboard/src/entities/email-settings/model/replyModel.test.ts` — 공통 파생 API로 추천 규칙 검증
- Modify: `apps/dashboard/src/features/email-settings-manage/api/replyModelCatalogAction.ts` — `always`/Haiku 제외 정책
- Create: `apps/dashboard/src/features/email-settings-manage/api/replyModelCatalogAction.test.ts` — 인증과 정책 adapter 테스트
- Modify: `apps/dashboard/src/features/email-settings-manage/ui/EmailSettingsForm.tsx` — 공통 선택 파생 사용
- Create: `apps/dashboard/src/features/email-settings-manage/ui/EmailSettingsForm.test.tsx` — live/fallback 가용성 UI 회귀

### Saju adapter and consumers

- Modify: `apps/dashboard/src/app/(dashboard)/fortune/[profileId]/page.tsx` — registry 기본값을 `always` 정책으로 변환
- Modify: `apps/dashboard/src/features/saju-model-picker/ui/SajuModelPicker.tsx` — snapshot과 공통 선택 파생 사용
- Create: `apps/dashboard/src/features/saju-model-picker/ui/SajuModelPicker.test.tsx` — 추천 그룹, 가용성, URL 갱신 회귀
- Modify: `apps/dashboard/src/shared/lib/llm/saju-model-registry-meta.ts` — 공통 공급사 타입 alias 명시
- Modify: `apps/dashboard/src/shared/lib/llm/saju-model-registry.test.ts` — 기존 순서와 parser 회귀 유지

---

### Task 1: Client-safe selection derivation

**Files:**

- Modify: `apps/dashboard/src/shared/lib/llm/provider-model-catalog.ts`
- Modify: `apps/dashboard/src/shared/lib/llm/provider-model-catalog.test.ts`

**Interfaces:**

- Consumes: 기존 `ProviderModelCatalog`, `LlmRecommendationRule`, `isLlmModelIdForProvider`, `sanitizeLlmModelId`
- Produces: `ProviderModelSelection`, `ProviderModelCatalogSnapshot`, `ModelAvailability`, `ModelOptions`, `deriveModelOptions(input)`

- [ ] **Step 1: Write failing tests for recommendation grouping and availability**

Update the import in `provider-model-catalog.test.ts` to include `deriveModelOptions` and remove `recommendLlmModels`. Replace the old generic recommendation describe block with the block below:

```ts
describe("deriveModelOptions", () => {
  const rules: Record<LlmProviderKey, readonly LlmRecommendationRule[]> = {
    claude: [
      { matches: (id) => id.includes("opus"), reason: "첫째" },
      { matches: (id) => id.includes("sonnet"), reason: "둘째" },
      { matches: (id) => id.includes("opus"), reason: "중복" },
    ],
    codex: [],
    gemini: [],
  };

  const catalog = catalogWith({
    claude: ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5"],
  });

  it("규칙 우선순위와 중복 제거를 적용하고 나머지를 other로 반환한다", () => {
    expect(
      deriveModelOptions({
        snapshot: { catalog, source: "live" },
        selection: { provider: "claude", modelId: "claude-opus-4-8" },
        recommendationRules: rules,
      }),
    ).toEqual({
      recommended: [
        { modelId: "claude-opus-4-8", reason: "첫째" },
        { modelId: "claude-sonnet-5", reason: "둘째" },
      ],
      other: ["claude-haiku-4-5"],
      availability: "available",
    });
  });

  it("live 목록에서 사라진 선택은 unavailable이다", () => {
    const result = deriveModelOptions({
      snapshot: { catalog, source: "live" },
      selection: { provider: "claude", modelId: "claude-opus-3" },
      recommendationRules: rules,
    });
    expect(result.availability).toBe("unavailable");
  });

  it("fallback snapshot은 목록 포함 여부와 무관하게 unknown이다", () => {
    const result = deriveModelOptions({
      snapshot: { catalog, source: "fallback" },
      selection: { provider: "claude", modelId: "claude-opus-3" },
      recommendationRules: rules,
    });
    expect(result.availability).toBe("unknown");
  });
});
```

In the existing Saju rule tests, replace each recommendation call with this shape and keep the existing assertions:

```ts
const result = deriveModelOptions({
  snapshot: { catalog, source: "live" },
  selection: { provider: "claude", modelId: catalog.claude[0] },
  recommendationRules: SAJU_MODEL_RECOMMENDATION_RULES,
}).recommended;
```

- [ ] **Step 2: Run the shared client test and verify RED**

Run:

```bash
pnpm --filter @gons/dashboard exec vitest run src/shared/lib/llm/provider-model-catalog.test.ts
```

Expected: FAIL because `deriveModelOptions` is not exported.

- [ ] **Step 3: Add the snapshot and selection types**

Add after `ProviderModelCatalog` in `provider-model-catalog.ts`:

```ts
export interface ProviderModelSelection {
  provider: LlmProviderKey;
  modelId: string;
}

export interface ProviderModelCatalogSnapshot {
  catalog: ProviderModelCatalog;
  source: "live" | "fallback";
}

export type ModelAvailability = "available" | "unavailable" | "unknown";

export interface ModelOptions {
  recommended: LlmModelRecommendation[];
  other: string[];
  availability: ModelAvailability;
}
```

Change the recommendation rule collection parameter to accept readonly arrays:

```ts
rules: Record<LlmProviderKey, readonly LlmRecommendationRule[]>,
```

- [ ] **Step 4: Implement the pure derivation entry point**

Add below the existing recommendation algorithm:

```ts
export interface DeriveModelOptionsInput {
  snapshot: ProviderModelCatalogSnapshot;
  selection: ProviderModelSelection;
  recommendationRules: Record<LlmProviderKey, readonly LlmRecommendationRule[]>;
}

export function deriveModelOptions({
  snapshot,
  selection,
  recommendationRules,
}: DeriveModelOptionsInput): ModelOptions {
  const recommended = recommendLlmModels(
    snapshot.catalog,
    selection.provider,
    recommendationRules,
  );
  const recommendedIds = new Set(recommended.map(({ modelId }) => modelId));
  const providerIds = snapshot.catalog[selection.provider];

  return {
    recommended,
    other: providerIds.filter((modelId) => !recommendedIds.has(modelId)),
    availability:
      snapshot.source === "fallback"
        ? "unknown"
        : providerIds.includes(selection.modelId)
          ? "available"
          : "unavailable",
  };
}
```

- [ ] **Step 5: Run the test and verify GREEN**

Run:

```bash
pnpm --filter @gons/dashboard exec vitest run src/shared/lib/llm/provider-model-catalog.test.ts
```

Expected: all tests in the file PASS.

- [ ] **Step 6: Commit the client-safe core**

```bash
git add apps/dashboard/src/shared/lib/llm/provider-model-catalog.ts apps/dashboard/src/shared/lib/llm/provider-model-catalog.test.ts
git commit -m "refactor: 모델 선택 파생 API 추가"
```

### Task 2: Policy-driven server catalog loader

**Files:**

- Create: `apps/dashboard/src/shared/lib/llm/provider-model-catalog-loader.ts`
- Create: `apps/dashboard/src/shared/lib/llm/provider-model-catalog-loader.test.ts`
- Modify: `apps/dashboard/src/shared/lib/llm/provider-model-catalog-server.ts`
- Create: `apps/dashboard/src/shared/lib/llm/provider-model-catalog-server.test.ts`

**Interfaces:**

- Consumes: `ProviderModelCatalogSnapshot`, 공급사 판별/모델 ID sanitize 함수, `env`, `logger`
- Produces: domain-facing `ProviderModelCatalogPolicy`, `loadProviderModelCatalog(policy)`; internal-only `createProviderModelCatalogLoader(source, reportFailure)`

- [ ] **Step 1: Write loader contract tests with an in-memory source**

Create `provider-model-catalog-loader.test.ts` with these core cases:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  createProviderModelCatalogLoader,
  type ProviderModelCatalogPolicy,
} from "./provider-model-catalog-loader";

const defaults = {
  claude: "claude-sonnet-5",
  codex: "gpt-5.5",
  gemini: "gemini-2.5-pro",
};

function policy(
  overrides: Partial<ProviderModelCatalogPolicy> = {},
): ProviderModelCatalogPolicy {
  return { defaults, defaultMode: "always", ...overrides };
}

describe("createProviderModelCatalogLoader", () => {
  it("always는 기본값을 앞에 두고 live 모델을 분류·중복 제거·정렬한다", async () => {
    const load = createProviderModelCatalogLoader(async () => [
      "claude-opus-4-8",
      "claude-opus-4-8",
      "gpt-5.4",
      "o3-pro",
      "gemini-3.1-pro",
    ]);
    await expect(load(policy())).resolves.toEqual({
      source: "live",
      catalog: {
        claude: ["claude-sonnet-5", "claude-opus-4-8"],
        codex: ["gpt-5.5", "o3-pro", "gpt-5.4"],
        gemini: ["gemini-2.5-pro", "gemini-3.1-pro"],
      },
    });
  });

  it("source-failure-only의 live 결과에는 기본값을 강제 삽입하지 않는다", async () => {
    const load = createProviderModelCatalogLoader(async () => [
      "claude-opus-4-8",
      "gpt-5.4",
      "gemini-3.1-pro",
    ]);
    const result = await load(policy({ defaultMode: "source-failure-only" }));
    expect(result).toEqual({
      source: "live",
      catalog: {
        claude: ["claude-opus-4-8"],
        codex: ["gpt-5.4"],
        gemini: ["gemini-3.1-pro"],
      },
    });
  });

  it("source 예외와 유효 모델 없는 응답은 기본값 fallback이다", async () => {
    const report = vi.fn();
    const offline = createProviderModelCatalogLoader(async () => {
      throw new Error("offline secret body");
    }, report);
    await expect(offline(policy())).resolves.toMatchObject({
      source: "fallback",
      catalog: {
        claude: ["claude-sonnet-5"],
        codex: ["gpt-5.5"],
        gemini: ["gemini-2.5-pro"],
      },
    });
    expect(report).toHaveBeenCalledWith({ reason: "connection" });

    const empty = createProviderModelCatalogLoader(async () => ["other-model"]);
    await expect(empty(policy())).resolves.toMatchObject({
      source: "fallback",
    });
  });

  it("allow를 원격 모델과 fallback 기본값에 적용한다", async () => {
    const load = createProviderModelCatalogLoader(async () => [
      "claude-haiku-4-5",
      "claude-opus-4-8",
    ]);
    const result = await load(
      policy({
        allow: { claude: (id) => !id.toLowerCase().includes("haiku") },
      }),
    );
    expect(result.catalog.claude).toEqual([
      "claude-sonnet-5",
      "claude-opus-4-8",
    ]);
  });

  it("source-failure-only fallback에서도 allow가 기본값에 적용된다", async () => {
    const load = createProviderModelCatalogLoader(async () => {
      throw new Error("offline");
    });
    const result = await load(
      policy({
        defaultMode: "source-failure-only",
        allow: { claude: () => false },
      }),
    );
    expect(result.source).toBe("fallback");
    expect(result.catalog.claude).toEqual([]);
  });

  it("정적 정책 오류는 source 호출 전에 실패한다", async () => {
    const source = vi.fn(async () => ["claude-opus-4-8"]);
    const load = createProviderModelCatalogLoader(source);
    const cases: Array<[ProviderModelCatalogPolicy, RegExp]> = [
      [
        policy({ defaults: { ...defaults, claude: "" } }),
        /claude default model/,
      ],
      [
        policy({ defaults: { ...defaults, claude: "gpt-5.5" } }),
        /claude default model/,
      ],
      [
        {
          ...policy(),
          defaultMode:
            "unsupported" as ProviderModelCatalogPolicy["defaultMode"],
        },
        /Unsupported defaultMode/,
      ],
      [policy({ allow: { claude: () => false } }), /rejected by allow policy/],
      [
        policy({
          allow: {
            claude: () => {
              throw new Error("default allow exploded");
            },
          },
        }),
        /default allow exploded/,
      ],
    ];

    for (const [invalidPolicy, message] of cases) {
      source.mockClear();
      await expect(load(invalidPolicy)).rejects.toThrow(message);
      expect(source).not.toHaveBeenCalled();
    }
  });

  it("원격 모델에 대한 allow 예외를 fallback으로 숨기지 않는다", async () => {
    const load = createProviderModelCatalogLoader(async () => [
      "claude-opus-4-8",
    ]);
    await expect(
      load(
        policy({
          allow: {
            claude: (id) => {
              if (id.includes("opus")) throw new Error("bad policy");
              return true;
            },
          },
        }),
      ),
    ).rejects.toThrow("bad policy");
  });
});
```

- [ ] **Step 2: Run the new server test and verify RED**

Run:

```bash
pnpm --filter @gons/dashboard exec vitest run src/shared/lib/llm/provider-model-catalog-loader.test.ts
```

Expected: FAIL because the internal loader module does not exist.

- [ ] **Step 3: Create the internal policy loader**

`provider-model-catalog-loader.ts` must contain these internal contracts. Domain code never imports this file directly:

```ts
import {
  LLM_PROVIDER_KEYS,
  isLlmModelIdForProvider,
  sanitizeLlmModelId,
  type LlmProviderKey,
  type ProviderModelCatalog,
  type ProviderModelCatalogSnapshot,
} from "./provider-model-catalog";

export interface ProviderModelCatalogPolicy {
  defaults: Record<LlmProviderKey, string>;
  defaultMode: "always" | "source-failure-only";
  allow?: Partial<Record<LlmProviderKey, (modelId: string) => boolean>>;
}

export interface ProviderModelSourceFailure {
  reason: "timeout" | "connection" | "http" | "invalid-json" | "empty";
  status?: number;
}

export type ProviderModelSource = () => Promise<readonly string[]>;
export type ProviderModelSourceFailureReporter = (
  failure: ProviderModelSourceFailure,
) => void;

export class ProviderModelSourceError extends Error {
  constructor(readonly failure: ProviderModelSourceFailure) {
    super(failure.reason);
  }
}
```

Implement the factory so policy validation precedes the source call, source errors are caught separately, and `allow` runs outside that catch:

```ts
export function createProviderModelCatalogLoader(
  source: ProviderModelSource,
  reportFailure: ProviderModelSourceFailureReporter = () => undefined,
) {
  return async function load(
    policy: ProviderModelCatalogPolicy,
  ): Promise<ProviderModelCatalogSnapshot> {
    const defaultAllowed = validatePolicy(policy);

    let sourceIds: readonly string[];
    try {
      sourceIds = await source();
    } catch (error) {
      const failure =
        error instanceof ProviderModelSourceError
          ? error.failure
          : ({ reason: "connection" } as const);
      reportFailure(failure);
      return buildFallbackSnapshot(policy, defaultAllowed);
    }

    const ids = sourceIds
      .map((id) => sanitizeLlmModelId(id))
      .filter((id): id is string => id !== null)
      .filter((id) =>
        LLM_PROVIDER_KEYS.some((provider) =>
          isLlmModelIdForProvider(provider, id),
        ),
      );

    if (ids.length === 0) {
      reportFailure({ reason: "empty" });
      return buildFallbackSnapshot(policy, defaultAllowed);
    }

    return {
      source: "live",
      catalog: buildLiveCatalog(ids, policy),
    };
  };
}
```

Use these exact policy rules in the private helpers:

```ts
function validatePolicy(
  policy: ProviderModelCatalogPolicy,
): Record<LlmProviderKey, boolean> {
  if (
    policy.defaultMode !== "always" &&
    policy.defaultMode !== "source-failure-only"
  ) {
    throw new Error(`Unsupported defaultMode: ${String(policy.defaultMode)}`);
  }

  const allowed = { claude: true, codex: true, gemini: true };
  for (const provider of LLM_PROVIDER_KEYS) {
    const modelId = policy.defaults[provider];
    if (
      sanitizeLlmModelId(modelId) !== modelId ||
      !isLlmModelIdForProvider(provider, modelId)
    ) {
      throw new Error(`Invalid ${provider} default model: ${String(modelId)}`);
    }
    allowed[provider] = policy.allow?.[provider]?.(modelId) ?? true;
    if (policy.defaultMode === "always" && !allowed[provider]) {
      throw new Error(`${provider} default model is rejected by allow policy`);
    }
  }
  return allowed;
}

function buildFallbackSnapshot(
  policy: ProviderModelCatalogPolicy,
  defaultAllowed: Record<LlmProviderKey, boolean>,
): ProviderModelCatalogSnapshot {
  return {
    source: "fallback",
    catalog: Object.fromEntries(
      LLM_PROVIDER_KEYS.map((provider) => [
        provider,
        defaultAllowed[provider] ? [policy.defaults[provider]] : [],
      ]),
    ) as ProviderModelCatalog,
  };
}
```

Implement live classification with this helper; do not catch an exception thrown by `allow`:

```ts
function buildLiveCatalog(
  ids: readonly string[],
  policy: ProviderModelCatalogPolicy,
): ProviderModelCatalog {
  const catalog: ProviderModelCatalog = { claude: [], codex: [], gemini: [] };

  for (const provider of LLM_PROVIDER_KEYS) {
    const defaultModel = policy.defaults[provider];
    const allow = policy.allow?.[provider];
    const remote = ids
      .filter((id) => isLlmModelIdForProvider(provider, id))
      .filter((id) => allow?.(id) ?? true);
    const candidates = [
      ...(policy.defaultMode === "always" ? [defaultModel] : []),
      ...remote,
    ];

    catalog[provider] = candidates
      .filter((id, index, all) => all.indexOf(id) === index)
      .sort((a, b) => {
        if (a === defaultModel) return -1;
        if (b === defaultModel) return 1;
        return b.localeCompare(a, undefined, { numeric: true });
      });
  }

  return catalog;
}
```

- [ ] **Step 4: Add the production HTTP source and safe structured logging**

Replace `provider-model-catalog-server.ts` with the production adapter. Import `createProviderModelCatalogLoader`, `ProviderModelSourceError`, and the policy/failure types from the internal loader; re-export only `ProviderModelCatalogPolicy` as a type for callers:

```ts
import "server-only";
import { env } from "@/shared/config/env";
import { logger } from "@/shared/lib/log";
import type {
  LlmProviderKey,
  ProviderModelCatalog,
} from "./provider-model-catalog";
import {
  createProviderModelCatalogLoader,
  ProviderModelSourceError,
} from "./provider-model-catalog-loader";

export type { ProviderModelCatalogPolicy } from "./provider-model-catalog-loader";

async function fetchProxyModelIds(): Promise<readonly string[]> {
  let response: Response;
  try {
    response = await fetch(`${env.ANTHROPIC_BASE_URL}/v1/models`, {
      headers: { "x-api-key": env.ANTHROPIC_API_KEY },
      signal: AbortSignal.timeout(3_000),
      cache: "no-store",
    });
  } catch (error) {
    const reason =
      error instanceof DOMException && error.name === "TimeoutError"
        ? "timeout"
        : "connection";
    throw new ProviderModelSourceError({ reason });
  }

  if (!response.ok) {
    throw new ProviderModelSourceError({
      reason: "http",
      status: response.status,
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ProviderModelSourceError({
      reason: "invalid-json",
      status: response.status,
    });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("data" in body) ||
    !Array.isArray(body.data)
  ) {
    return [];
  }

  return body.data
    .map((item) =>
      typeof item === "object" && item !== null && "id" in item
        ? item.id
        : null,
    )
    .filter((id): id is string => typeof id === "string");
}

export const loadProviderModelCatalog = createProviderModelCatalogLoader(
  fetchProxyModelIds,
  (failure) =>
    logger.warn("provider-model-catalog", "source-fallback", failure),
);
```

Temporarily retain this compatibility wrapper until Tasks 4 and 5 migrate all callers:

```ts
/** @deprecated Use loadProviderModelCatalog with an explicit policy. */
export async function listProviderModelCatalog(
  defaults: Record<LlmProviderKey, string>,
): Promise<ProviderModelCatalog> {
  return (await loadProviderModelCatalog({ defaults, defaultMode: "always" }))
    .catalog;
}
```

- [ ] **Step 5: Add HTTP failure/log redaction tests**

Create `provider-model-catalog-server.test.ts` with hoisted mocks and the exact failure cases:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));

vi.mock("@/shared/config/env", () => ({
  env: {
    ANTHROPIC_BASE_URL: "http://proxy.test",
    ANTHROPIC_API_KEY: "test-api-key",
  },
}));
vi.mock("@/shared/lib/log", () => ({
  logger: { warn: warnMock },
}));

import { loadProviderModelCatalog } from "./provider-model-catalog-server";

const policy = {
  defaults: {
    claude: "claude-sonnet-5",
    codex: "gpt-5.5",
    gemini: "gemini-2.5-pro",
  },
  defaultMode: "always" as const,
};

beforeEach(() => {
  vi.restoreAllMocks();
  warnMock.mockClear();
});

describe("loadProviderModelCatalog HTTP source", () => {
  it("HTTP 실패를 본문·URL·키 없이 기록하고 fallback한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("secret response body", { status: 503 }),
    );

    await expect(loadProviderModelCatalog(policy)).resolves.toMatchObject({
      source: "fallback",
    });
    expect(warnMock).toHaveBeenCalledWith(
      "provider-model-catalog",
      "source-fallback",
      { reason: "http", status: 503 },
    );
    const logs = JSON.stringify(warnMock.mock.calls);
    expect(logs).not.toContain("test-api-key");
    expect(logs).not.toContain("secret response body");
    expect(logs).not.toContain("proxy.test");
  });

  it("timeout을 분류한다", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new DOMException("timed out", "TimeoutError"),
    );
    await expect(loadProviderModelCatalog(policy)).resolves.toMatchObject({
      source: "fallback",
    });
    expect(warnMock).toHaveBeenLastCalledWith(
      "provider-model-catalog",
      "source-fallback",
      { reason: "timeout" },
    );
  });

  it("깨진 JSON을 분류한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("{", { status: 200 }),
    );
    await expect(loadProviderModelCatalog(policy)).resolves.toMatchObject({
      source: "fallback",
    });
    expect(warnMock).toHaveBeenLastCalledWith(
      "provider-model-catalog",
      "source-fallback",
      { reason: "invalid-json", status: 200 },
    );
  });

  it("빈 모델 목록을 분류한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ data: [] }),
    );
    await expect(loadProviderModelCatalog(policy)).resolves.toMatchObject({
      source: "fallback",
    });
    expect(warnMock).toHaveBeenLastCalledWith(
      "provider-model-catalog",
      "source-fallback",
      { reason: "empty" },
    );
  });
});
```

The HTTP failure assertion is deliberately limited to:

```ts
expect(warnMock).toHaveBeenCalledWith(
  "provider-model-catalog",
  "source-fallback",
  { reason: "http", status: 503 },
);
expect(JSON.stringify(warnMock.mock.calls)).not.toContain("test-api-key");
expect(JSON.stringify(warnMock.mock.calls)).not.toContain(
  "secret response body",
);
expect(JSON.stringify(warnMock.mock.calls)).not.toContain("proxy.test");
```

- [ ] **Step 6: Run shared server and client tests**

Run:

```bash
pnpm --filter @gons/dashboard exec vitest run src/shared/lib/llm/provider-model-catalog.test.ts src/shared/lib/llm/provider-model-catalog-loader.test.ts src/shared/lib/llm/provider-model-catalog-server.test.ts
```

Expected: both files PASS.

- [ ] **Step 7: Commit the server loader**

```bash
git add apps/dashboard/src/shared/lib/llm/provider-model-catalog-loader.ts apps/dashboard/src/shared/lib/llm/provider-model-catalog-loader.test.ts apps/dashboard/src/shared/lib/llm/provider-model-catalog-server.ts apps/dashboard/src/shared/lib/llm/provider-model-catalog-server.test.ts
git commit -m "refactor: 정책 기반 모델 카탈로그 로더 추가"
```

### Task 3: Migrate the memo adapter and selection UI

**Files:**

- Modify: `apps/dashboard/src/entities/memo/model/types.ts`
- Modify: `apps/dashboard/src/entities/memo/model/model-recommendations.ts`
- Modify: `apps/dashboard/src/entities/memo/model/model-recommendations.test.ts`
- Modify: `apps/dashboard/src/entities/memo/client.ts`
- Modify: `apps/dashboard/src/entities/memo/server.ts`
- Replace: `apps/dashboard/src/features/memo-transform/lib/model-catalog.ts`
- Modify: `apps/dashboard/src/features/memo-transform/lib/model-catalog.test.ts`
- Modify: `apps/dashboard/src/app/(dashboard)/memos/settings/page.tsx`
- Modify: `apps/dashboard/src/features/memo-preset-manage/ui/ModelSelectionFields.tsx`
- Modify: `apps/dashboard/src/features/memo-preset-manage/ui/PresetSettings.tsx`
- Modify: `apps/dashboard/src/features/memo-preset-manage/ui/PresetEditor.tsx`
- Modify: `apps/dashboard/src/features/memo-preset-manage/ui/PresetSettings.test.tsx`
- Modify: `apps/dashboard/src/features/memo-preset-manage/api/previewPresetAction.ts`
- Modify: `apps/dashboard/src/features/memo-preset-manage/api/presetActions.test.ts`

**Interfaces:**

- Consumes: `loadProviderModelCatalog`, `deriveModelOptions`, `ProviderModelCatalogSnapshot`
- Produces: `loadMemoModelCatalog()`, `getMemoModelAvailability(selection)`, `MEMO_MODEL_RECOMMENDATION_RULES`

- [ ] **Step 1: Convert memo duplicate types and recommendation implementation into aliases/rules**

In `entities/memo/model/types.ts`, import the shared values/types and replace the duplicate declarations with:

```ts
import {
  LLM_PROVIDER_KEYS,
  isLlmModelIdForProvider,
  type LlmProviderKey,
  type ProviderModelCatalog,
  type ProviderModelCatalogSnapshot,
} from "@/shared/lib/llm/provider-model-catalog";

export const MEMO_MODEL_KEYS = LLM_PROVIDER_KEYS;
export type MemoModelKey = LlmProviderKey;
export const DEFAULT_MEMO_MODEL_KEY: MemoModelKey = "claude";

export interface MemoModelSelection {
  model: MemoModelKey;
  modelId: string;
}

export type MemoModelCatalog = ProviderModelCatalog;
export type MemoModelCatalogSnapshot = ProviderModelCatalogSnapshot;
export const isMemoModelIdForProvider = isLlmModelIdForProvider;
```

Keep `MEMO_MODEL_META`, `isMemoModelKey`, DB-derived types, and preset constants unchanged.

Replace `model-recommendations.ts` with the existing domain rules only:

```ts
import type {
  LlmProviderKey,
  LlmRecommendationRule,
} from "@/shared/lib/llm/provider-model-catalog";

export const MEMO_MODEL_RECOMMENDATION_RULES: Record<
  LlmProviderKey,
  readonly LlmRecommendationRule[]
> = {
  claude: [
    {
      matches: (id) => id.includes("sonnet"),
      reason: "품질·속도 균형 — 기본 추천",
    },
    { matches: (id) => id.includes("haiku"), reason: "가장 빠르고 경제적" },
    {
      matches: (id) => id.includes("opus"),
      reason: "최고 품질 — 길고 복잡한 메모",
    },
  ],
  codex: [
    {
      matches: (id) =>
        id.startsWith("gpt-") &&
        !id.includes("oss") &&
        !id.includes("codex") &&
        !id.includes("image"),
      reason: "범용 고품질 — 기본 추천",
    },
    { matches: (id) => id.includes("oss"), reason: "경량 — 빠른 일상 정리" },
    { matches: (id) => id.includes("codex"), reason: "구조화·목록 정리 특화" },
  ],
  gemini: [
    {
      matches: (id) => id.includes("pro"),
      reason: "긴 문맥·자연스러운 문장 — 기본 추천",
    },
    { matches: (id) => id.includes("flash"), reason: "가장 빠르고 경제적" },
  ],
};
```

Update client/server entrypoints to export `MemoModelCatalogSnapshot` and client.ts to export `MEMO_MODEL_RECOMMENDATION_RULES`; remove `recommendMemoModels` and `MemoModelRecommendation` exports.

- [ ] **Step 2: Rewrite memo recommendation tests against the common derivation API**

Keep the existing family fixtures, but call:

```ts
deriveModelOptions({
  snapshot: { catalog, source: "live" },
  selection: {
    provider: "claude",
    modelId: catalog.claude[0] ?? "claude-sonnet-5",
  },
  recommendationRules: MEMO_MODEL_RECOMMENDATION_RULES,
}).recommended;
```

Expected assertions remain sonnet → haiku → opus for Claude, generic → OSS → Codex for Codex, and Pro → Flash for Gemini.

- [ ] **Step 3: Run memo rule tests and verify they pass after removing the duplicate algorithm**

Run:

```bash
pnpm --filter @gons/dashboard exec vitest run src/entities/memo/model/types.test.ts src/entities/memo/model/model-recommendations.test.ts
```

Expected: PASS.

- [ ] **Step 4: Replace memo HTTP/catalog logic with a domain policy adapter**

The resulting `features/memo-transform/lib/model-catalog.ts` must be:

```ts
import "server-only";
import {
  MEMO_MODEL_RECOMMENDATION_RULES,
  type MemoModelSelection,
} from "@/entities/memo/client";
import {
  deriveModelOptions,
  type ModelAvailability,
  type ProviderModelCatalogSnapshot,
} from "@/shared/lib/llm/provider-model-catalog";
import { loadProviderModelCatalog } from "@/shared/lib/llm/provider-model-catalog-server";
import { resolveMemoModelId } from "./model-registry";

function memoDefaults() {
  return {
    claude: resolveMemoModelId("claude"),
    codex: resolveMemoModelId("codex"),
    gemini: resolveMemoModelId("gemini"),
  };
}

export async function loadMemoModelCatalog(): Promise<ProviderModelCatalogSnapshot> {
  return loadProviderModelCatalog({
    defaults: memoDefaults(),
    defaultMode: "source-failure-only",
  });
}

export async function getMemoModelAvailability(
  selection: MemoModelSelection,
): Promise<ModelAvailability> {
  const snapshot = await loadMemoModelCatalog();
  return deriveModelOptions({
    snapshot,
    selection: { provider: selection.model, modelId: selection.modelId },
    recommendationRules: MEMO_MODEL_RECOMMENDATION_RULES,
  }).availability;
}
```

Rewrite `model-catalog.test.ts` around the adapter boundary:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadProviderModelCatalogMock } = vi.hoisted(() => ({
  loadProviderModelCatalogMock: vi.fn(),
}));

vi.mock("@/shared/config/env", () => ({
  env: {
    MEMO_LLM_MODEL_CLAUDE: "claude-sonnet-5",
    MEMO_LLM_MODEL_CODEX: "gpt-5.5",
    MEMO_LLM_MODEL_GEMINI: "gemini-pro-latest",
  },
}));
vi.mock("@/shared/lib/llm/provider-model-catalog-server", () => ({
  loadProviderModelCatalog: loadProviderModelCatalogMock,
}));

import {
  getMemoModelAvailability,
  loadMemoModelCatalog,
} from "./model-catalog";

const catalog = {
  claude: ["claude-sonnet-5"],
  codex: ["gpt-5.5"],
  gemini: ["gemini-pro-latest"],
};

beforeEach(() => loadProviderModelCatalogMock.mockReset());

describe("memo model catalog adapter", () => {
  it("env 기본값과 source-failure-only 정책을 전달한다", async () => {
    loadProviderModelCatalogMock.mockResolvedValue({ source: "live", catalog });
    await loadMemoModelCatalog();
    expect(loadProviderModelCatalogMock).toHaveBeenCalledWith({
      defaults: {
        claude: "claude-sonnet-5",
        codex: "gpt-5.5",
        gemini: "gemini-pro-latest",
      },
      defaultMode: "source-failure-only",
    });
  });

  it("live 누락은 unavailable, fallback 누락은 unknown이다", async () => {
    loadProviderModelCatalogMock
      .mockResolvedValueOnce({ source: "live", catalog })
      .mockResolvedValueOnce({ source: "fallback", catalog });
    const selection = { model: "codex" as const, modelId: "gpt-5.6-luna" };
    await expect(getMemoModelAvailability(selection)).resolves.toBe(
      "unavailable",
    );
    await expect(getMemoModelAvailability(selection)).resolves.toBe("unknown");
  });
});
```

- [ ] **Step 5: Run the memo adapter test**

Run:

```bash
pnpm --filter @gons/dashboard exec vitest run src/features/memo-transform/lib/model-catalog.test.ts
```

Expected: PASS without mocking or calling global `fetch`.

- [ ] **Step 6: Pass the snapshot from the memo settings page through the UI**

In the page, replace `listMemoModelCatalog()` with `loadMemoModelCatalog()` and pass `modelCatalogSnapshot` to `PresetSettings`.

In `PresetSettings.tsx` and `PresetEditor.tsx`, accept:

```ts
modelCatalogSnapshot: MemoModelCatalogSnapshot;
```

Use `const modelCatalog = modelCatalogSnapshot.catalog` for existing lookup code and pass the full snapshot into every `ModelSelectionFields` instance.

Replace the props/calculation portion of `ModelSelectionFields.tsx` with:

```ts
interface ModelSelectionFieldsProps {
  idPrefix: string;
  value: MemoModelSelection | null;
  snapshot: MemoModelCatalogSnapshot;
  inheritFrom?: MemoModelSelection;
  disabled?: boolean;
  onChange: (value: MemoModelSelection | null) => void;
}

const catalog = snapshot.catalog;
const effectiveSelection = value ?? inheritFrom;
const options = effectiveSelection
  ? deriveModelOptions({
      snapshot,
      selection: {
        provider: effectiveSelection.model,
        modelId: effectiveSelection.modelId,
      },
      recommendationRules: MEMO_MODEL_RECOMMENDATION_RULES,
    })
  : null;
const recommendations = value ? (options?.recommended ?? []) : [];
const otherIds = value ? (options?.other ?? []) : [];
const unavailable = options?.availability === "unavailable";
```

Render the disabled unavailable `<option>` and the red alert only when `unavailable` is true. Preserve all current labels, inheritance behavior, and `MEMO_MODEL_KEYS` display order.

- [ ] **Step 7: Update memo UI fixtures for snapshot source semantics**

Change the shared fixture in `PresetSettings.test.tsx` to:

```ts
const MODEL_CATALOG_SNAPSHOT = {
  source: "live" as const,
  catalog: MODEL_CATALOG,
};
```

Pass `modelCatalogSnapshot={MODEL_CATALOG_SNAPSHOT}`. Retain the existing recommended/other group tests and add a fallback regression by rendering:

```ts
modelCatalogSnapshot={{
  source: "fallback",
  catalog: {
    claude: ["claude-sonnet-5"],
    codex: ["gpt-5.5"],
    gemini: ["gemini-pro-latest"],
  },
}}
```

with a saved non-default model and assert `screen.queryByText(/현재 프록시의 사용 가능 목록/)` is null.

- [ ] **Step 8: Migrate preview availability without changing its result union**

In `previewPresetAction.ts`, replace the old boolean/null call with:

```ts
const availability = await getMemoModelAvailability(selection);
if (availability === "unavailable") return { kind: "model-unavailable" };
```

Update the mock in `presetActions.test.ts` to expose `getMemoModelAvailability`. Keep the existing `"unavailable"` rejection test and add:

```ts
it("카탈로그 조회 실패로 unknown이면 LLM 호출을 시도한다", async () => {
  modelAvailabilityMock.mockResolvedValue("unknown");
  transformMock.mockResolvedValue({ kind: "transformed", content: "결과" });

  await expect(
    previewPresetAction({
      instruction: "지시사항",
      fidelityGuard: true,
      model: "codex",
      modelId: "gpt-5.6-luna",
      sampleText: "샘플 텍스트입니다",
    }),
  ).resolves.toEqual({ kind: "ok", content: "결과" });
  expect(transformMock).toHaveBeenCalled();
});
```

- [ ] **Step 9: Run memo domain regression tests**

Run:

```bash
pnpm --filter @gons/dashboard exec vitest run src/entities/memo/model/types.test.ts src/entities/memo/model/model-recommendations.test.ts src/features/memo-transform/lib/model-catalog.test.ts src/features/memo-transform/lib/preset-resolver.test.ts src/features/memo-preset-manage/ui/PresetSettings.test.tsx src/features/memo-preset-manage/api/presetActions.test.ts
```

Expected: all listed files PASS.

- [ ] **Step 10: Commit the memo migration**

```bash
git add \
  apps/dashboard/src/entities/memo/model/types.ts \
  apps/dashboard/src/entities/memo/model/model-recommendations.ts \
  apps/dashboard/src/entities/memo/model/model-recommendations.test.ts \
  apps/dashboard/src/entities/memo/client.ts \
  apps/dashboard/src/entities/memo/server.ts \
  apps/dashboard/src/features/memo-transform/lib/model-catalog.ts \
  apps/dashboard/src/features/memo-transform/lib/model-catalog.test.ts \
  'apps/dashboard/src/app/(dashboard)/memos/settings/page.tsx' \
  apps/dashboard/src/features/memo-preset-manage/ui/ModelSelectionFields.tsx \
  apps/dashboard/src/features/memo-preset-manage/ui/PresetSettings.tsx \
  apps/dashboard/src/features/memo-preset-manage/ui/PresetEditor.tsx \
  apps/dashboard/src/features/memo-preset-manage/ui/PresetSettings.test.tsx \
  apps/dashboard/src/features/memo-preset-manage/api/previewPresetAction.ts \
  apps/dashboard/src/features/memo-preset-manage/api/presetActions.test.ts
git commit -m "refactor: 메모 모델 카탈로그를 공통 코어로 이동"
```

### Task 4: Migrate email reply catalog policy and UI

**Files:**

- Modify: `apps/dashboard/src/entities/email-settings/model/replyModel.ts`
- Modify: `apps/dashboard/src/entities/email-settings/model/replyModel.test.ts`
- Modify: `apps/dashboard/src/features/email-settings-manage/api/replyModelCatalogAction.ts`
- Create: `apps/dashboard/src/features/email-settings-manage/api/replyModelCatalogAction.test.ts`
- Modify: `apps/dashboard/src/features/email-settings-manage/ui/EmailSettingsForm.tsx`
- Create: `apps/dashboard/src/features/email-settings-manage/ui/EmailSettingsForm.test.tsx`

**Interfaces:**

- Consumes: `loadProviderModelCatalog({ defaultMode: "always", allow })`, `deriveModelOptions`
- Produces: `ReplyModelCatalogData { snapshot, defaults }`

- [ ] **Step 1: Change reply catalog data to carry source information**

In `replyModel.ts`, import `LlmProviderKey` and `ProviderModelCatalogSnapshot`, alias `ReplyModelKey = LlmProviderKey` while retaining `REPLY_MODEL_KEYS = ["gemini", "codex", "claude"] as const`, and change the response type to:

```ts
export interface ReplyModelCatalogData {
  snapshot: ProviderModelCatalogSnapshot;
  defaults: Record<ReplyModelKey, string>;
}
```

Update `replyModel.test.ts` recommendation calls to `deriveModelOptions(...).recommended` using `source: "live"`. Keep assertions for display order and parser fallback.

- [ ] **Step 2: Write the authenticated action policy test**

Create `replyModelCatalogAction.test.ts` with these hoisted mocks and assertions:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, resolveReplyModelIdMock, loadProviderModelCatalogMock } =
  vi.hoisted(() => ({
    authMock: vi.fn(),
    resolveReplyModelIdMock: vi.fn(),
    loadProviderModelCatalogMock: vi.fn(),
  }));

vi.mock("@/shared/lib/auth", () => ({ auth: authMock }));
vi.mock("@/shared/lib/llm/reply-model-registry", () => ({
  resolveReplyModelId: resolveReplyModelIdMock,
}));
vi.mock("@/shared/lib/llm/provider-model-catalog-server", () => ({
  loadProviderModelCatalog: loadProviderModelCatalogMock,
}));

import { replyModelCatalogAction } from "./replyModelCatalogAction";

const ids = {
  gemini: "gemini-2.5-pro",
  codex: "gpt-5.5",
  claude: "claude-opus-4-8",
};

beforeEach(() => {
  authMock.mockReset();
  resolveReplyModelIdMock.mockReset();
  loadProviderModelCatalogMock.mockReset();
  resolveReplyModelIdMock.mockImplementation((key: keyof typeof ids) =>
    Promise.resolve(ids[key]),
  );
  loadProviderModelCatalogMock.mockResolvedValue({
    source: "live",
    catalog: {
      gemini: [ids.gemini],
      codex: [ids.codex],
      claude: [ids.claude],
    },
  });
});

describe("replyModelCatalogAction", () => {
  it("인증되지 않은 요청은 registry와 proxy를 호출하지 않는다", async () => {
    authMock.mockResolvedValue(null);
    await expect(replyModelCatalogAction()).resolves.toBeNull();
    expect(resolveReplyModelIdMock).not.toHaveBeenCalled();
    expect(loadProviderModelCatalogMock).not.toHaveBeenCalled();
  });

  it("always와 Haiku 제외 정책을 공통 로더에 전달한다", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    await replyModelCatalogAction();
    expect(loadProviderModelCatalogMock).toHaveBeenCalledWith({
      defaults: {
        gemini: "gemini-2.5-pro",
        codex: "gpt-5.5",
        claude: "claude-opus-4-8",
      },
      defaultMode: "always",
      allow: { claude: expect.any(Function) },
    });
    const passedPolicy = loadProviderModelCatalogMock.mock.calls[0][0];
    expect(passedPolicy.allow.claude("claude-haiku-4-5")).toBe(false);
    expect(passedPolicy.allow.claude("claude-opus-4-8")).toBe(true);
  });
});
```

- [ ] **Step 3: Run the action test and verify RED**

Run:

```bash
pnpm --filter @gons/dashboard exec vitest run src/features/email-settings-manage/api/replyModelCatalogAction.test.ts
```

Expected: FAIL because the action still calls `listProviderModelCatalog` and manually filters Haiku.

- [ ] **Step 4: Move the reply policy into the loader call**

Replace the catalog portion of `replyModelCatalogAction.ts` with:

```ts
const defaults = { gemini, codex, claude };
const snapshot = await loadProviderModelCatalog({
  defaults,
  defaultMode: "always",
  allow: {
    claude: (modelId) => !modelId.toLowerCase().includes("haiku"),
  },
});

return { snapshot, defaults };
```

No filter remains in the action after loading.

- [ ] **Step 5: Replace reply UI recommendation/availability calculations**

In `EmailSettingsForm.tsx`, replace `recommendLlmModels` with `deriveModelOptions` and calculate:

```ts
const effectiveModelId = modelId ?? catalogData?.defaults[modelKey] ?? "";
const modelOptions =
  catalogData && effectiveModelId
    ? deriveModelOptions({
        snapshot: catalogData.snapshot,
        selection: { provider: modelKey, modelId: effectiveModelId },
        recommendationRules: REPLY_MODEL_RECOMMENDATION_RULES,
      })
    : null;
const recommendations = modelOptions?.recommended ?? [];
const otherModelIds = modelOptions?.other ?? [];
const modelUnavailable = modelOptions?.availability === "unavailable";
```

Update the provider-change branch to narrow the optional catalog explicitly:

```ts
if (catalogData) {
  const catalog = catalogData.snapshot.catalog;
  const fallback = catalogData.defaults[key];
  setModelId(
    catalog[key].includes(fallback) ? fallback : (catalog[key][0] ?? null),
  );
} else {
  setModelId(null);
}
```

Use `catalogData.snapshot.catalog[modelKey]` in the loaded JSX branch. Preserve lazy loading, `REPLY_MODEL_KEYS` order, labels, form field names, and unavailable copy.

- [ ] **Step 6: Add live/fallback UI tests**

Create `EmailSettingsForm.test.tsx` with this jsdom setup and focused fixture:

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { EMAIL_SETTINGS_DEFAULTS } from "@/entities/email-settings/client";

const { catalogActionMock } = vi.hoisted(() => ({
  catalogActionMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("../api/replyModelCatalogAction", () => ({
  replyModelCatalogAction: catalogActionMock,
}));
vi.mock("../api/updateEmailSettings", () => ({
  updateEmailSettings: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../api/syncNowAction", () => ({
  syncNowAction: vi.fn(async () => ({ ok: true, classified: 0 })),
}));
vi.mock("../api/reclassifyAction", () => ({
  reclassifyAction: vi.fn(async () => ({ ok: true, classified: 0 })),
}));

import { EmailSettingsForm } from "./EmailSettingsForm";

const initial = {
  ...EMAIL_SETTINGS_DEFAULTS,
  replyModel: "gemini" as const,
  replyModelId: "gemini-old-pro",
};

function catalogData(source: "live" | "fallback") {
  return {
    defaults: {
      gemini: "gemini-2.5-pro",
      codex: "gpt-5.5",
      claude: "claude-opus-4-8",
    },
    snapshot: {
      source,
      catalog: {
        gemini: ["gemini-2.5-pro"],
        codex: ["gpt-5.5"],
        claude: ["claude-opus-4-8"],
      },
    },
  } as const;
}

beforeEach(() => catalogActionMock.mockReset());
afterEach(cleanup);

describe("EmailSettingsForm model catalog", () => {
  it("live 목록에서 사라진 저장 모델을 사용 불가로 표시한다", async () => {
    catalogActionMock.mockResolvedValue(catalogData("live"));
    render(<EmailSettingsForm initial={initial} onDone={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "현재 프록시의 사용 가능 목록",
    );
  });

  it("fallback에서는 저장 모델을 사용 불가로 단정하지 않고 순서를 보존한다", async () => {
    catalogActionMock.mockResolvedValue(catalogData("fallback"));
    render(<EmailSettingsForm initial={initial} onDone={vi.fn()} />);
    await waitFor(() => expect(catalogActionMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/현재 프록시의 사용 가능 목록/)).toBeNull();
    const provider = screen.getByLabelText("답장 AI 공급사");
    expect(
      within(provider)
        .getAllByRole("option")
        .map((option) => (option as HTMLOptionElement).value),
    ).toEqual(["gemini", "codex", "claude"]);
  });
});
```

- [ ] **Step 7: Run reply domain tests**

Run:

```bash
pnpm --filter @gons/dashboard exec vitest run src/entities/email-settings/model/replyModel.test.ts src/features/email-settings-manage/api/_schema.test.ts src/features/email-settings-manage/api/replyModelCatalogAction.test.ts src/features/email-settings-manage/ui/EmailSettingsForm.test.tsx
```

Expected: all listed files PASS.

- [ ] **Step 8: Commit the reply migration**

```bash
git add apps/dashboard/src/entities/email-settings/model/replyModel.ts apps/dashboard/src/entities/email-settings/model/replyModel.test.ts apps/dashboard/src/features/email-settings-manage/api/replyModelCatalogAction.ts apps/dashboard/src/features/email-settings-manage/api/replyModelCatalogAction.test.ts apps/dashboard/src/features/email-settings-manage/ui/EmailSettingsForm.tsx apps/dashboard/src/features/email-settings-manage/ui/EmailSettingsForm.test.tsx
git commit -m "refactor: 답장 모델 카탈로그 정책을 공통 로더로 이동"
```

### Task 5: Migrate Saju catalog policy and picker

**Files:**

- Modify: `apps/dashboard/src/app/(dashboard)/fortune/[profileId]/page.tsx`
- Modify: `apps/dashboard/src/features/saju-model-picker/ui/SajuModelPicker.tsx`
- Create: `apps/dashboard/src/features/saju-model-picker/ui/SajuModelPicker.test.tsx`
- Modify: `apps/dashboard/src/shared/lib/llm/saju-model-registry-meta.ts`
- Modify: `apps/dashboard/src/shared/lib/llm/saju-model-registry.test.ts`

**Interfaces:**

- Consumes: Saju registry defaults, `loadProviderModelCatalog({ defaultMode: "always" })`, `deriveModelOptions`
- Produces: picker prop `snapshot: ProviderModelCatalogSnapshot`; URL and four reading widget props remain unchanged

- [ ] **Step 1: Alias the Saju provider type without changing display order**

In `saju-model-registry-meta.ts`, import `LlmProviderKey` and set:

```ts
export const SAJU_MODEL_KEYS = ["claude", "codex", "gemini"] as const;
export type SajuModelKey = LlmProviderKey;
```

Keep `SAJU_MODEL_KEYS`, `SAJU_MODEL_META`, parser behavior, recommendation rules, and default key unchanged. The existing registry test must continue to expect `["claude", "codex", "gemini"]`.

- [ ] **Step 2: Write picker tests before changing its props**

Create `SajuModelPicker.test.tsx` with the jsdom environment, router mocks, and three tests:

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { replaceMock, searchParamsState } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  searchParamsState: { value: "" },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => new URLSearchParams(searchParamsState.value),
}));

import { SajuModelPicker } from "./SajuModelPicker";

function renderPickerWithSearchParams(value: string) {
  searchParamsState.value = value;
  return render(
    <SajuModelPicker
      selected="claude"
      selectedModelId="claude-opus-4-8"
      snapshot={{
        source: "live",
        catalog: {
          claude: ["claude-opus-4-8", "claude-sonnet-5"],
          codex: ["gpt-5.5"],
          gemini: ["gemini-2.5-pro"],
        },
      }}
    />,
  );
}

beforeEach(() => replaceMock.mockClear());
afterEach(cleanup);

describe("SajuModelPicker", () => {
  it("live 목록에서 사라진 모델을 사용 불가로 표시한다", () => {
    render(
      <SajuModelPicker
        selected="claude"
        selectedModelId="claude-opus-3"
        snapshot={{
          source: "live",
          catalog: { claude: ["claude-opus-4-8"], codex: [], gemini: [] },
        }}
      />,
    );
    expect(screen.getByText(/claude-opus-3 \(현재 사용 불가\)/)).toBeTruthy();
  });

  it("fallback에서는 확인 불가 모델을 사용 불가로 단정하지 않는다", () => {
    render(
      <SajuModelPicker
        selected="claude"
        selectedModelId="claude-opus-3"
        snapshot={{
          source: "fallback",
          catalog: { claude: ["claude-opus-4-8"], codex: [], gemini: [] },
        }}
      />,
    );
    expect(screen.queryByText(/현재 사용 불가/)).toBeNull();
  });

  it("모델 변경 시 기존 query를 보존하고 model/modelId를 갱신한다", () => {
    renderPickerWithSearchParams("tab=daily");
    fireEvent.change(screen.getByLabelText("상세 모델"), {
      target: { value: "claude-sonnet-5" },
    });
    expect(replaceMock).toHaveBeenCalledWith(
      "?tab=daily&model=claude&modelId=claude-sonnet-5",
      { scroll: false },
    );
  });
});
```

- [ ] **Step 3: Run the picker test and verify RED**

Run:

```bash
pnpm --filter @gons/dashboard exec vitest run src/features/saju-model-picker/ui/SajuModelPicker.test.tsx
```

Expected: FAIL because the component still accepts `catalog` and computes availability directly.

- [ ] **Step 4: Migrate the picker to the common derivation API**

Change the prop and calculation to:

```ts
interface Props {
  selected: SajuModelKey;
  selectedModelId: string;
  snapshot: ProviderModelCatalogSnapshot;
}

const options = deriveModelOptions({
  snapshot,
  selection: { provider: selected, modelId: selectedModelId },
  recommendationRules: SAJU_MODEL_RECOMMENDATION_RULES,
});
const catalog = snapshot.catalog;
const recommendations = options.recommended;
const otherModelIds = options.other;
const unavailable = options.availability === "unavailable";
```

Preserve `SAJU_MODEL_KEYS` rendering, router behavior, labels, and option groups.

- [ ] **Step 5: Migrate the RSC page to the explicit always policy**

Replace `listProviderModelCatalog` with:

```ts
const modelCatalogSnapshot = await loadProviderModelCatalog({
  defaults: {
    claude: registry.claude.id,
    codex: registry.codex.id,
    gemini: registry.gemini.id,
  },
  defaultMode: "always",
});
```

Pass `snapshot={modelCatalogSnapshot}` to `SajuModelPicker`. Do not alter URL normalization or the existing `modelId={modelId}` props on `SajuTriLifetime`, `SajuTriYearly`, `SajuTriMonthly`, and `SajuTriDaily`.

- [ ] **Step 6: Run Saju picker, parser, handler, and cache regression tests**

Run:

```bash
pnpm --filter @gons/dashboard exec vitest run src/features/saju-model-picker/ui/SajuModelPicker.test.tsx src/shared/lib/llm/saju-model-registry.test.ts src/shared/lib/saju/createNarrativeCache.test.ts src/shared/lib/saju/smoke.test.ts
```

Expected: all listed files PASS. Confirm the page still contains exactly four `modelId={modelId}` widget props:

```bash
rg -n 'modelId=\{modelId\}' 'apps/dashboard/src/app/(dashboard)/fortune/[profileId]/page.tsx'
```

Expected: four matches for lifetime, yearly, monthly, and daily widgets.

- [ ] **Step 7: Commit the Saju migration**

```bash
git add 'apps/dashboard/src/app/(dashboard)/fortune/[profileId]/page.tsx' apps/dashboard/src/features/saju-model-picker/ui/SajuModelPicker.tsx apps/dashboard/src/features/saju-model-picker/ui/SajuModelPicker.test.tsx apps/dashboard/src/shared/lib/llm/saju-model-registry-meta.ts apps/dashboard/src/shared/lib/llm/saju-model-registry.test.ts
git commit -m "refactor: 사주 모델 카탈로그를 공통 로더로 이동"
```

### Task 6: Remove compatibility APIs and verify the whole application

**Files:**

- Modify: `apps/dashboard/src/shared/lib/llm/provider-model-catalog.ts`
- Modify: `apps/dashboard/src/shared/lib/llm/provider-model-catalog-server.ts`
- Modify: comments/imports reported by the searches below

**Interfaces:**

- Consumes: all migrated callers from Tasks 3–5
- Produces: only `deriveModelOptions` and `loadProviderModelCatalog` as behavior-bearing catalog APIs

- [ ] **Step 1: Remove compatibility implementations**

Delete the exported `recommendLlmModels` compatibility name and replace it with this private helper; update `deriveModelOptions` to call `matchRecommendedModels`:

```ts
function matchRecommendedModels(
  catalog: ProviderModelCatalog,
  provider: LlmProviderKey,
  rules: Record<LlmProviderKey, readonly LlmRecommendationRule[]>,
): LlmModelRecommendation[] {
  const ids = catalog[provider];
  const taken = new Set<string>();
  const recommendations: LlmModelRecommendation[] = [];
  for (const rule of rules[provider]) {
    const match = ids.find(
      (id) => !taken.has(id) && rule.matches(id.toLowerCase()),
    );
    if (match) {
      taken.add(match);
      recommendations.push({ modelId: match, reason: rule.reason });
    }
  }
  return recommendations;
}
```

Delete `listProviderModelCatalog` from the server module and remove its now-unused `LlmProviderKey`/`ProviderModelCatalog` imports. There must be no `buildMemoModelCatalog`, `listMemoModelCatalog`, `isMemoModelCurrentlyAvailable`, or `recommendMemoModels` implementation left.

- [ ] **Step 2: Prove duplicate behavior and stale imports are gone**

Run each search; all must return no matches:

```bash
rg -n 'listProviderModelCatalog|buildMemoModelCatalog|listMemoModelCatalog|isMemoModelCurrentlyAvailable|recommendMemoModels' apps/dashboard/src
```

```bash
rg -n 'fetch\(`\$\{env\.ANTHROPIC_BASE_URL\}/v1/models`' apps/dashboard/src/features apps/dashboard/src/entities
```

Run this search and expect exactly one implementation site in the shared server module:

```bash
rg -n 'ANTHROPIC_BASE_URL.*/v1/models' apps/dashboard/src/shared/lib/llm/provider-model-catalog-server.ts
```

- [ ] **Step 3: Run focused catalog/domain tests**

Run:

```bash
pnpm --filter @gons/dashboard exec vitest run src/shared/lib/llm/provider-model-catalog.test.ts src/shared/lib/llm/provider-model-catalog-loader.test.ts src/shared/lib/llm/provider-model-catalog-server.test.ts src/entities/memo/model/model-recommendations.test.ts src/features/memo-transform/lib/model-catalog.test.ts src/features/memo-preset-manage/ui/PresetSettings.test.tsx src/features/memo-preset-manage/api/presetActions.test.ts src/entities/email-settings/model/replyModel.test.ts src/features/email-settings-manage/api/replyModelCatalogAction.test.ts src/features/email-settings-manage/ui/EmailSettingsForm.test.tsx src/features/saju-model-picker/ui/SajuModelPicker.test.tsx src/shared/lib/saju/createNarrativeCache.test.ts
```

Expected: all listed files PASS.

- [ ] **Step 4: Run static verification**

Run:

```bash
pnpm typecheck
```

Expected: exit 0.

Run:

```bash
pnpm lint
```

Expected: exit 0 with no new warnings.

- [ ] **Step 5: Run the full test suite**

Run:

```bash
pnpm test
```

Expected: exit 0; every workspace test passes.

- [ ] **Step 6: Run the production build**

Run with the repository's established placeholder environment command if local secrets are absent:

```bash
env DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder REDIS_URL=redis://localhost:6379 NEXTAUTH_SECRET=a-placeholder-secret-of-at-least-32-characters NEXTAUTH_URL=http://localhost:3020 GOOGLE_CLIENT_ID=placeholder GOOGLE_CLIENT_SECRET=placeholder ANTHROPIC_BASE_URL=http://placeholder ANTHROPIC_API_KEY=placeholder CRON_BEARER_TOKEN=a-placeholder-cron-token-of-at-least-32-characters ALLOWLIST_EMAILS=build@placeholder.local ADMIN_EMAILS=build@placeholder.local pnpm build
```

Expected: Next.js production build exits 0, proving no server-only module leaked into a client bundle.

- [ ] **Step 7: Commit cleanup and verification state**

```bash
git add apps/dashboard/src/shared/lib/llm/provider-model-catalog.ts apps/dashboard/src/shared/lib/llm/provider-model-catalog-server.ts
git commit -m "refactor: 모델 카탈로그 호환 계층 제거"
```

- [ ] **Step 8: Review the final commit range**

Run:

```bash
git status --short
git log --oneline --decorate -7
git diff --check HEAD~6..HEAD
```

Expected: only pre-existing untracked `.context/` and `AGENTS.md` remain; the six implementation commits plus this plan/design history are visible; diff check reports no whitespace errors.
