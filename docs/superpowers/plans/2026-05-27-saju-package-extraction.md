# @krdn/saju 패키지 분리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `packages/saju`를 별도 GitHub 레포(`krdn/saju`)로 분리하고, 프롬프트·Zod 스키마·타입을 추가해 `@krdn/saju` v1.0.0으로 퍼블리시한 뒤, gons-dashboard가 외부 패키지로 소비하도록 전환한다.

**Architecture:** 기존 `packages/saju`의 계산 엔진(92파일)을 그대로 이식하고, dashboard features 4개에 흩어진 프롬프트(4파일)·Zod 스키마(4파일)·narrative 타입(`db/schema.ts`에서 추출)을 패키지에 추가한다. `computeFrameHash` 유틸을 `narrative-server.ts`에서 추출해 패키지에 포함. 기존 API 이름(`buildTriNationLifetime` 등)을 유지해 dashboard 수정 범위를 최소화한다.

**Tech Stack:** TypeScript, tsup (ESM), Zod, vitest, GitHub Packages, pnpm

**Spec:** `docs/superpowers/specs/2026-05-27-saju-package-extraction-design.md`

**Spec → 코드 보정사항:**
1. API 이름: spec의 `buildLifetimeFrame` → 실제 `buildTriNationLifetime` 유지
2. 타입 소유권 역전: `NarrativeSchool`, `SchoolSpecific*`, `*NarrativeSections`, `NarrativeKeyTerm`이 `@krdn/saju`로 이동. dashboard `db/schema.ts`는 패키지에서 re-import
3. 계산 엔진·프레임 빌더·상수는 이미 `packages/saju`에 존재 — 이식만 수행. 신규 추가: prompts, schemas, frameHash, narrative 타입
4. Dockerfile 패치 필수: `packages/saju` COPY 라인 제거 (메모리 `workspace-package-dockerfile-gotcha`)

---

## Phase 1: 새 레포 생성 + 코드 이식 → v1.0.0

### Task 1: GitHub 레포 생성 + 프로젝트 초기화

**Files:**
- Create: `krdn/saju/package.json`
- Create: `krdn/saju/tsconfig.json`
- Create: `krdn/saju/tsup.config.ts`
- Create: `krdn/saju/vitest.config.ts`
- Create: `krdn/saju/.gitignore`

- [ ] **Step 1: GitHub 레포 생성**

```bash
gh repo create krdn/saju --private --description "Four Pillars of Destiny (Saju) — computation engine, prompts, and schemas"
cd /home/gon/projects && mkdir -p krdn && cd krdn
git clone git@github.com:krdn/saju.git
cd saju
```

- [ ] **Step 2: package.json 작성**

```json
{
  "name": "@krdn/saju",
  "version": "1.0.0",
  "type": "module",
  "description": "Four Pillars of Destiny (Saju) — multi-school computation engine with prompts and Zod schemas",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "README.md", "CHANGELOG.md"],
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "prepack": "pnpm build"
  },
  "engines": { "node": ">=20" },
  "dependencies": {
    "korean-lunar-calendar": "^0.3.6",
    "lunar-javascript": "1.7.7",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^20",
    "tsup": "^8.5.1",
    "tsx": "^4.19.2",
    "typescript": "^5",
    "vitest": "^4.1.5"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/krdn/saju.git"
  }
}
```

- [ ] **Step 3: tsconfig.json 작성**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true,
    "isolatedModules": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

- [ ] **Step 4: tsup.config.ts 작성**

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist",
  shims: true,
  minify: false,
  splitting: false,
  external: ["korean-lunar-calendar", "lunar-javascript", "zod"],
});
```

- [ ] **Step 5: vitest.config.ts 작성**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 6: .gitignore 작성**

```
node_modules/
dist/
*.tsbuildinfo
.env
```

- [ ] **Step 7: pnpm install 및 검증**

```bash
pnpm install
```

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "chore: 프로젝트 초기화 — package.json, tsconfig, tsup, vitest"
```

---

### Task 2: 계산 엔진 이식

**Files:**
- Copy: `gons-dashboard/packages/saju/src/**/*.ts` → `krdn/saju/src/` (테스트 제외)
- Copy: 테스트 파일 38개

- [ ] **Step 1: 소스 파일 복사 (테스트 제외)**

```bash
SRC=/home/gon/projects/gon/gons-dashboard/packages/saju/src
DST=/home/gon/projects/krdn/saju/src

cd "$SRC"
find . -name "*.ts" ! -name "*.test.ts" ! -name "*.spec.ts" | while read f; do
  mkdir -p "$DST/$(dirname "$f")"
  cp "$f" "$DST/$f"
done
```

- [ ] **Step 2: 테스트 파일 복사**

```bash
cd "$SRC"
find . -name "*.test.ts" -o -name "*.spec.ts" | while read f; do
  cp "$f" "$DST/$f"
done

TESTS_SRC=/home/gon/projects/gon/gons-dashboard/packages/saju/tests
TESTS_DST=/home/gon/projects/krdn/saju/tests
if [ -d "$TESTS_SRC" ]; then
  mkdir -p "$TESTS_DST"
  cp -r "$TESTS_SRC"/* "$TESTS_DST/"
fi
```

- [ ] **Step 3: tsconfig 조정**

기존 `packages/saju/tsconfig.json`은 `"extends": "../../tsconfig.base.json"`으로 모노레포 base를 참조. 새 레포에서는 Task 1의 독립 tsconfig를 사용하므로 별도 조정 불필요. 단, `src/lunar-javascript.d.ts` 타입 선언 파일이 있으면 포함 확인.

- [ ] **Step 4: 빌드 검증**

```bash
cd /home/gon/projects/krdn/saju
pnpm typecheck
```

Expected: PASS

- [ ] **Step 5: 테스트 실행**

```bash
pnpm test
```

Expected: 38개 테스트 전부 PASS

- [ ] **Step 6: 빌드**

```bash
pnpm build
ls dist/index.js dist/index.d.ts
```

Expected: dist/에 ESM 번들 + 타입 선언 파일 생성

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: 계산 엔진 이식 — packages/saju 전체 소스 + 테스트 38개"
```

---

### Task 3: narrative 타입 추가

**Files:**
- Create: `krdn/saju/src/narrative-types.ts`

현재 `gons-dashboard/apps/dashboard/src/shared/lib/db/schema.ts:575-649`에 정의된 타입들을 패키지로 이동. DB 의존성 없는 순수 TypeScript 인터페이스.

- [ ] **Step 1: narrative-types.ts 작성**

```typescript
export type NarrativeSchool = "ko" | "cn-ziping" | "cn-mangpai" | "jp";

export interface NarrativeKeyTerm {
  term: string;
  gloss: string;
}

export interface LifetimeNarrativeSections {
  personality: string;
  career: string;
  relationship: string;
  health: string;
  daeunSummary: string;
  keyTerms: NarrativeKeyTerm[];
  cautions: string[];
}

export interface YearlyNarrativeSections {
  personality: string;
  career: string;
  relationship: string;
  health: string;
  daeunSummary: string;
  keyTerms: NarrativeKeyTerm[];
  cautions: string[];
}

export interface MonthlyNarrativeSections {
  personality: string;
  career: string;
  relationship: string;
  health: string;
  daeunSummary: string;
  keyTerms: NarrativeKeyTerm[];
  cautions: string[];
}

export type SchoolSpecificKo = {
  joohuFocus: string;
  shinsalNotes: string[];
};

export type SchoolSpecificZiping = {
  gyeokgukRationale: string;
  yongshinAnalysis: string;
};

export type SchoolSpecificMangpai = {
  eventTimings: Array<{ period: string; event: string }>;
};

export type SchoolSpecificJp = {
  palaceMap: Array<{ palace: string; note: string }>;
};

export type SchoolSpecific =
  | SchoolSpecificKo
  | SchoolSpecificZiping
  | SchoolSpecificMangpai
  | SchoolSpecificJp;
```

- [ ] **Step 2: typecheck**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 3: 커밋**

```bash
git add src/narrative-types.ts
git commit -m "feat: narrative 타입 추가 — NarrativeSchool, Sections, SchoolSpecific"
```

---

### Task 4: computeFrameHash 유틸 추가

**Files:**
- Create: `krdn/saju/src/frame-hash.ts`
- Create: `krdn/saju/src/frame-hash.test.ts`

`narrative-server.ts` 4파일에서 동일하게 인라인 사용되는 SHA256 해시 로직을 추출.

- [ ] **Step 1: 테스트 작성**

```typescript
import { describe, it, expect } from "vitest";
import { computeFrameHash } from "./frame-hash";

describe("computeFrameHash", () => {
  it("returns 64-char hex string", () => {
    const frame = { school: "ko", pillars: { year: "甲子" } };
    const hash = computeFrameHash(frame);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic", () => {
    const frame = { a: 1, b: "test" };
    expect(computeFrameHash(frame)).toBe(computeFrameHash(frame));
  });

  it("differs for different input", () => {
    expect(computeFrameHash({ a: 1 })).not.toBe(computeFrameHash({ a: 2 }));
  });
});
```

- [ ] **Step 2: 테스트 실행 → FAIL**

```bash
pnpm vitest run src/frame-hash.test.ts
```

Expected: FAIL — `Cannot find module './frame-hash'`

- [ ] **Step 3: 구현**

```typescript
import { createHash } from "node:crypto";

export function computeFrameHash(frame: unknown): string {
  return createHash("sha256").update(JSON.stringify(frame)).digest("hex");
}
```

- [ ] **Step 4: 테스트 실행 → PASS**

```bash
pnpm vitest run src/frame-hash.test.ts
```

Expected: 3 tests PASS

- [ ] **Step 5: 커밋**

```bash
git add src/frame-hash.ts src/frame-hash.test.ts
git commit -m "feat: computeFrameHash 유틸 추가 — SHA256 프레임 해시"
```

---

### Task 5: 프롬프트 템플릿 이식

**Files:**
- Create: `krdn/saju/src/prompts/constants.ts`
- Create: `krdn/saju/src/prompts/system.ts`
- Create: `krdn/saju/src/prompts/lifetime.ts`
- Create: `krdn/saju/src/prompts/yearly.ts`
- Create: `krdn/saju/src/prompts/monthly.ts`
- Create: `krdn/saju/src/prompts/daily.ts`
- Source: `gons-dashboard/apps/dashboard/src/features/saju-{lifetime,yearly,monthly,daily}-tri/api/prompts.ts`

각 features의 prompts.ts에서 SCHOOL_PROMPTS와 PROMPT_VERSION을 추출. `NarrativeSchool` import를 패키지 내부 `narrative-types.ts`로 교체.

- [ ] **Step 1: constants.ts 작성**

```typescript
export const PROMPT_VERSIONS = {
  lifetime: 3,
  yearly: 3,
  monthly: 4,
  daily: 2,
} as const;
```

- [ ] **Step 2: system.ts — PromptBundle 타입 정의**

```typescript
export interface PromptBundle {
  system: string;
  user: string;
}
```

- [ ] **Step 3: lifetime.ts — 프롬프트 이식**

`gons-dashboard/features/saju-lifetime-tri/api/prompts.ts`에서 `COMMON_HEADER`, `KO_BODY`, `ZIPING_BODY`, `MANGPAI_BODY`, `JP_BODY` 전문을 복사.

변경점:
- `import type { NarrativeSchool } from "@/shared/lib/db/schema"` → `import type { NarrativeSchool } from "../narrative-types"`
- `export const PROMPT_VERSION = 3` 제거 (constants.ts로 이동)
- `SCHOOL_PROMPTS` → `LIFETIME_SCHOOL_PROMPTS` (소비자에서 시간축 구별)
- `buildLifetimePrompt(frame, school)` 래퍼 함수 추가

```typescript
import type { NarrativeSchool } from "../narrative-types";
import type { PromptBundle } from "./system";

const COMMON_HEADER = `당신은 30년 경력의 사주 명리학 전문가입니다...`;
// (gons-dashboard 원본에서 전문 복사 — 97줄짜리 파일의 15~103행)

const KO_BODY = `[학파 고유 관점 — 한국식 자평+조후+신살]...`;
const ZIPING_BODY = `[학파 고유 관점 — 중국 자평진전·적천수]...`;
const MANGPAI_BODY = `[학파 고유 관점 — 중국 맹파 단건업]...`;
const JP_BODY = `[학파 고유 관점 — 일본 추명학]...`;

export const LIFETIME_SCHOOL_PROMPTS: Record<NarrativeSchool, string> = {
  ko: `${COMMON_HEADER}\n\n${KO_BODY}`,
  "cn-ziping": `${COMMON_HEADER}\n\n${ZIPING_BODY}`,
  "cn-mangpai": `${COMMON_HEADER}\n\n${MANGPAI_BODY}`,
  jp: `${COMMON_HEADER}\n\n${JP_BODY}`,
};

const LIFETIME_USER_SUFFIX = `위 명조를 다음 JSON 스키마로만 답하세요. 마크다운 헤더, 펜스, prose 설명, 인사말 모두 금지. '{' 로 시작해서 '}' 로 끝나는 JSON 본문만 출력:
{"narrativeText":"1500~2000자 5문단","sections":{"personality":"...","career":"...","relationship":"...","health":"...","daeunSummary":"...","keyTerms":[{"term":"...","gloss":"..."}],"cautions":["..."]},"schoolSpecific":{...학파별...},"citations":["출처1","출처2"]}`;

export function buildLifetimePrompt(
  frame: unknown,
  school: NarrativeSchool,
): PromptBundle {
  return {
    system: LIFETIME_SCHOOL_PROMPTS[school],
    user: `명조 분석:\n${JSON.stringify(frame, null, 2)}\n\n${LIFETIME_USER_SUFFIX}`,
  };
}
```

- [ ] **Step 4: yearly.ts — 동일 패턴, yearly prompts.ts에서 복사**

변경점: COMMON_HEADER 내용이 다름 (분량 1200~1600자, sections 200~280자). export: `YEARLY_SCHOOL_PROMPTS`, `buildYearlyPrompt`.

- [ ] **Step 5: monthly.ts — 동일 패턴, monthly prompts.ts에서 복사**

변경점: 분량 800~1200자, sections 150~200자. export: `MONTHLY_SCHOOL_PROMPTS`, `buildMonthlyPrompt`.

- [ ] **Step 6: daily.ts — 동일 패턴, daily prompts.ts에서 복사**

변경점: 분량 800~1200자, sections 150~200자. export: `DAILY_SCHOOL_PROMPTS`, `buildDailyPrompt`.

- [ ] **Step 7: typecheck**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 8: 커밋**

```bash
git add src/prompts/
git commit -m "feat: 프롬프트 템플릿 이식 — 4시간축 × 4학파 + PromptBundle"
```

---

### Task 6: Zod 응답 스키마 이식

**Files:**
- Create: `krdn/saju/src/schemas/common.ts`
- Create: `krdn/saju/src/schemas/lifetime.ts`
- Create: `krdn/saju/src/schemas/yearly.ts`
- Create: `krdn/saju/src/schemas/monthly.ts`
- Create: `krdn/saju/src/schemas/daily.ts`
- Create: `krdn/saju/src/schemas/lifetime.test.ts`
- Source: `gons-dashboard/apps/dashboard/src/features/saju-*-tri/api/schemas.ts`

각 features의 schemas.ts를 이식. `@/shared/lib/db/schema` import를 `../narrative-types`로 교체.

- [ ] **Step 1: common.ts — 공통 normalizer 함수 추출**

```typescript
export function normalizeStringArray(v: unknown): unknown {
  const toStr = (item: unknown): string => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.entries(item)
        .map(([k, val]) => `${k}: ${typeof val === "string" ? val : JSON.stringify(val)}`)
        .join(" / ");
    }
    return String(item);
  };
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.map(toStr);
  if (v && typeof v === "object") {
    return Object.entries(v).map(
      ([k, val]) => `${k}: ${typeof val === "string" ? val : JSON.stringify(val)}`,
    );
  }
  return v;
}

export function normalizeEventTiming(v: unknown): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const obj = v as Record<string, unknown>;
  if (!obj.period && (obj.time || obj.timing || obj.timeSlot)) {
    return { ...obj, period: obj.time ?? obj.timing ?? obj.timeSlot };
  }
  return v;
}
```

- [ ] **Step 2: lifetime.ts — lifetime 스키마 이식**

`gons-dashboard/features/saju-lifetime-tri/api/schemas.ts` 전문을 복사하되 import 교체:
- `import type { NarrativeSchool } from "./prompts"` → `import type { NarrativeSchool } from "../narrative-types"`
- `import type { LifetimeNarrativeSections, SchoolSpecific, SchoolSpecificKo, ... } from "@/shared/lib/db/schema"` → `import type { ... } from "../narrative-types"`
- `import { normalizeStringArray, normalizeEventTiming } from "./common"`
- export 이름: `LIFETIME_SCHOOL_SCHEMAS`, `LifetimeNarrativeOutput`

기존 `SCHOOL_SCHEMAS` → `LIFETIME_SCHOOL_SCHEMAS`로 rename.
기존 `NarrativeOutput` → `LifetimeNarrativeOutput`로 rename.

- [ ] **Step 3: yearly.ts, monthly.ts, daily.ts — 동일 패턴**

각각 해당 features의 schemas.ts에서 복사. 시간축별 차이:
- yearly: `narrativeText` min 400/max 2000, `sections` min 60, export `YEARLY_SCHOOL_SCHEMAS`, `YearlyNarrativeOutput`
- monthly: `narrativeText` min 200/max 1500, `sections` min 50, `eventTimings` min 3/max 5, export `MONTHLY_SCHOOL_SCHEMAS`, `MonthlyNarrativeOutput`
- daily: `narrativeText` min 200/max 1500, `sections` min 50, `eventTimings` min 3/max 5, `palaceMap` min 3/max 6, export `DAILY_SCHOOL_SCHEMAS`, `DailyNarrativeOutput`

- [ ] **Step 4: lifetime.test.ts — 스키마 기본 테스트**

```typescript
import { describe, it, expect } from "vitest";
import { LIFETIME_SCHOOL_SCHEMAS } from "./lifetime";

describe("LIFETIME_SCHOOL_SCHEMAS", () => {
  const validKoOutput = {
    narrativeText: "A".repeat(500),
    sections: {
      personality: "A".repeat(80),
      career: "A".repeat(80),
      relationship: "A".repeat(80),
      health: "A".repeat(80),
      daeunSummary: "A".repeat(80),
    },
    schoolSpecific: { joohuFocus: "A".repeat(30), shinsalNotes: ["note1"] },
    citations: ["citation1"],
  };

  it("parses valid ko output", () => {
    const result = LIFETIME_SCHOOL_SCHEMAS.ko.safeParse(validKoOutput);
    expect(result.success).toBe(true);
  });

  it("rejects too-short narrativeText", () => {
    const result = LIFETIME_SCHOOL_SCHEMAS.ko.safeParse({
      ...validKoOutput,
      narrativeText: "short",
    });
    expect(result.success).toBe(false);
  });

  it("normalizes string shinsalNotes to array", () => {
    const input = {
      ...validKoOutput,
      schoolSpecific: { joohuFocus: "A".repeat(30), shinsalNotes: "괴강, 도화" },
    };
    const result = LIFETIME_SCHOOL_SCHEMAS.ko.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Array.isArray(result.data.schoolSpecific.shinsalNotes)).toBe(true);
    }
  });
});
```

- [ ] **Step 5: 테스트 실행**

```bash
pnpm vitest run src/schemas/lifetime.test.ts
```

Expected: 3 tests PASS

- [ ] **Step 6: typecheck + 전체 테스트**

```bash
pnpm typecheck && pnpm test
```

Expected: 전부 PASS

- [ ] **Step 7: 커밋**

```bash
git add src/schemas/
git commit -m "feat: Zod 응답 스키마 이식 — 4시간축 학파별 스키마 + normalizer"
```

---

### Task 7: index.ts 업데이트 + 빌드 + 태그

**Files:**
- Modify: `krdn/saju/src/index.ts`

기존 계산 엔진 export 아래에 신규 모듈을 추가.

- [ ] **Step 1: index.ts에 신규 export 추가**

기존 `index.ts` 끝에 추가:

```typescript
// --- Narrative types (v1.0 신규) ---
export type {
  NarrativeSchool,
  NarrativeKeyTerm,
  LifetimeNarrativeSections,
  YearlyNarrativeSections,
  MonthlyNarrativeSections,
  SchoolSpecificKo,
  SchoolSpecificZiping,
  SchoolSpecificMangpai,
  SchoolSpecificJp,
  SchoolSpecific,
} from "./narrative-types";

// --- Frame hash ---
export { computeFrameHash } from "./frame-hash";

// --- Prompt constants & builders ---
export { PROMPT_VERSIONS } from "./prompts/constants";
export type { PromptBundle } from "./prompts/system";
export { buildLifetimePrompt, LIFETIME_SCHOOL_PROMPTS } from "./prompts/lifetime";
export { buildYearlyPrompt, YEARLY_SCHOOL_PROMPTS } from "./prompts/yearly";
export { buildMonthlyPrompt, MONTHLY_SCHOOL_PROMPTS } from "./prompts/monthly";
export { buildDailyPrompt, DAILY_SCHOOL_PROMPTS } from "./prompts/daily";

// --- Response schemas ---
export { LIFETIME_SCHOOL_SCHEMAS, type LifetimeNarrativeOutput } from "./schemas/lifetime";
export { YEARLY_SCHOOL_SCHEMAS, type YearlyNarrativeOutput } from "./schemas/yearly";
export { MONTHLY_SCHOOL_SCHEMAS, type MonthlyNarrativeOutput } from "./schemas/monthly";
export { DAILY_SCHOOL_SCHEMAS, type DailyNarrativeOutput } from "./schemas/daily";
```

- [ ] **Step 2: 최종 빌드 + 테스트**

```bash
pnpm typecheck && pnpm test && pnpm build
```

Expected: 전부 PASS. dist/에 번들 생성.

- [ ] **Step 3: 커밋 + 태그 + 푸시**

```bash
git add -A
git commit -m "feat: v1.0.0 — 계산 엔진 + 프롬프트 + 스키마 통합 패키지"
git tag v1.0.0
git push origin main --tags
```

---

## Phase 2: gons-dashboard 전환

### Task 8: 의존성 교체 + packages/saju 제거

**Files:**
- Modify: `gons-dashboard/apps/dashboard/package.json` — `@gons/saju` → `@krdn/saju`
- Modify: `gons-dashboard/pnpm-workspace.yaml` — packages/saju 항목 제거
- Delete: `gons-dashboard/packages/saju/` (전체 디렉토리)
- Modify: `gons-dashboard/apps/dashboard/Dockerfile` — packages/saju COPY 라인 제거

- [ ] **Step 1: apps/dashboard/package.json 수정**

`"@gons/saju": "workspace:*"` → `"@krdn/saju": "github:krdn/saju#v1.0.0"`

- [ ] **Step 2: pnpm-workspace.yaml 수정**

packages/saju 항목이 있으면 제거.

- [ ] **Step 3: packages/saju/ 디렉토리 삭제**

```bash
rm -rf packages/saju
```

- [ ] **Step 4: Dockerfile 수정**

`apps/dashboard/Dockerfile`의 두 stage (deps + builder) 모두에서 `COPY packages/saju/` 또는 `packages/saju` 관련 COPY 라인 제거.

- [ ] **Step 5: pnpm install**

```bash
pnpm install
```

Expected: `@krdn/saju` GitHub tarball 설치 성공

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "refactor: @gons/saju → @krdn/saju 외부 패키지 전환 + packages/saju 제거"
```

---

### Task 9: import 경로 + 코드 교체

**Files:**
- Modify: `@gons/saju` import 전부 → `@krdn/saju`
- Modify: `shared/lib/db/schema.ts` — narrative 타입을 패키지에서 re-export
- Modify: `features/saju-{lifetime,yearly,monthly,daily}-tri/api/prompts.ts` (4파일)
- Modify: `features/saju-{lifetime,yearly,monthly,daily}-tri/api/schemas.ts` (4파일)
- Modify: `features/saju-{lifetime,yearly,monthly,daily}-tri/api/narrative-server.ts` (4파일)

- [ ] **Step 1: @gons/saju → @krdn/saju 일괄 교체**

```bash
grep -rl "@gons/saju" apps/ --include="*.ts" --include="*.tsx" | \
  xargs sed -i 's/@gons\/saju/@krdn\/saju/g'
```

- [ ] **Step 2: shared/lib/db/schema.ts — narrative 타입 re-export**

`schema.ts:575-649`의 인라인 타입 정의(`NarrativeKeyTerm`, `LifetimeNarrativeSections`, `YearlyNarrativeSections`, `MonthlyNarrativeSections`, `NarrativeSchool`, `SchoolSpecificKo/Ziping/Mangpai/Jp`, `SchoolSpecific`)를 삭제하고 패키지에서 re-export:

```typescript
export type {
  NarrativeSchool,
  NarrativeKeyTerm,
  LifetimeNarrativeSections,
  YearlyNarrativeSections,
  MonthlyNarrativeSections,
  SchoolSpecificKo,
  SchoolSpecificZiping,
  SchoolSpecificMangpai,
  SchoolSpecificJp,
  SchoolSpecific,
} from "@krdn/saju";
```

DB 테이블 정의에서 `$type<LifetimeNarrativeSections>()` 참조는 re-export된 타입을 그대로 사용.
`NarrativeSections` deprecated alias도 유지: `export type NarrativeSections = YearlyNarrativeSections;`

- [ ] **Step 3: features/saju-lifetime-tri/api/prompts.ts 교체**

기존 97줄짜리 내용을 제거하고 패키지에서 re-export:

```typescript
export { LIFETIME_SCHOOL_PROMPTS as SCHOOL_PROMPTS } from "@krdn/saju";
export { PROMPT_VERSIONS } from "@krdn/saju";
export const PROMPT_VERSION = 3;
export type { NarrativeSchool } from "@krdn/saju";
```

`PROMPT_VERSION`은 `narrative-server.ts`의 캐시 키에서 직접 참조하므로 re-export 유지. 값은 `PROMPT_VERSIONS.lifetime`과 동기화 필수.

- [ ] **Step 4: features/saju-yearly-tri/api/prompts.ts 교체**

```typescript
export { YEARLY_SCHOOL_PROMPTS as SCHOOL_PROMPTS } from "@krdn/saju";
export { PROMPT_VERSIONS } from "@krdn/saju";
export const PROMPT_VERSION = 3;
export type { NarrativeSchool } from "@krdn/saju";
```

- [ ] **Step 5: features/saju-monthly-tri/api/prompts.ts 교체**

```typescript
export { MONTHLY_SCHOOL_PROMPTS as SCHOOL_PROMPTS } from "@krdn/saju";
export { PROMPT_VERSIONS } from "@krdn/saju";
export const PROMPT_VERSION = 4;
export type { NarrativeSchool } from "@krdn/saju";
```

- [ ] **Step 6: features/saju-daily-tri/api/prompts.ts 교체**

```typescript
export { DAILY_SCHOOL_PROMPTS as SCHOOL_PROMPTS } from "@krdn/saju";
export { PROMPT_VERSIONS } from "@krdn/saju";
export const PROMPT_VERSION = 2;
export type { NarrativeSchool } from "@krdn/saju";
```

- [ ] **Step 7: features/saju-*-tri/api/schemas.ts 교체 (4파일)**

각 파일의 ~140줄짜리 스키마 정의를 제거하고 패키지에서 re-export:

```typescript
// lifetime:
export { LIFETIME_SCHOOL_SCHEMAS as SCHOOL_SCHEMAS, type LifetimeNarrativeOutput as NarrativeOutput } from "@krdn/saju";

// yearly:
export { YEARLY_SCHOOL_SCHEMAS as SCHOOL_SCHEMAS, type YearlyNarrativeOutput as NarrativeOutput } from "@krdn/saju";

// monthly:
export { MONTHLY_SCHOOL_SCHEMAS as SCHOOL_SCHEMAS, type MonthlyNarrativeOutput as NarrativeOutput } from "@krdn/saju";

// daily:
export { DAILY_SCHOOL_SCHEMAS as SCHOOL_SCHEMAS, type DailyNarrativeOutput as NarrativeOutput } from "@krdn/saju";
```

- [ ] **Step 8: narrative-server.ts (4파일) — computeFrameHash 사용**

각 `narrative-server.ts`에서:
1. `import { createHash } from "node:crypto"` 제거
2. 기존 `@gons/saju`(이미 Step 1에서 `@krdn/saju`로 교체됨) import에 `computeFrameHash` 추가
3. 인라인 `createHash("sha256").update(JSON.stringify(frame)).digest("hex")` → `computeFrameHash(frame)` 교체

예시 (lifetime):
```typescript
// Before:
import { createHash } from "node:crypto";
import { ALGORITHM_VERSION, type LifetimeFrame } from "@krdn/saju";
// ...
const frameHash = createHash("sha256").update(JSON.stringify(frame)).digest("hex");

// After:
import { ALGORITHM_VERSION, computeFrameHash, type LifetimeFrame } from "@krdn/saju";
// ...
const frameHash = computeFrameHash(frame);
```

- [ ] **Step 9: typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

Expected: PASS

- [ ] **Step 10: 커밋**

```bash
git add -A
git commit -m "refactor: 프롬프트·스키마·타입·frameHash를 @krdn/saju에서 import"
```

---

### Task 10: 빌드 검증

**Files:** (검증만, 수정 없음)

- [ ] **Step 1: production build**

```bash
cd /home/gon/projects/gon/gons-dashboard/apps/dashboard
pnpm build
```

Expected: PASS. server/client barrel seam 문제 없음 확인.

- [ ] **Step 2: 테스트**

```bash
cd /home/gon/projects/gon/gons-dashboard
pnpm test
```

Expected: PASS (DB 미연결 통합 테스트는 ECONNREFUSED — 정상)

- [ ] **Step 3: 최종 커밋 (수정 있으면)**

```bash
git add -A
git commit -m "refactor: @krdn/saju 전환 완료 — 빌드·테스트 검증"
```

---

## Phase 3: afterschool 전환 (별도 PR)

### Task 11: afterschool에 @krdn/saju 적용

**Files:**
- Modify: `ai-afterschool-fsd/package.json`
- Create: `ai-afterschool-fsd/.npmrc` (또는 수정)
- Modify: `ai-afterschool-fsd/src/features/analysis/saju/saju.ts`

- [ ] **Step 1: .npmrc에 GitHub Packages 설정 추가**

```
@krdn:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

- [ ] **Step 2: 의존성 추가**

```bash
cd /home/gon/projects/ai/ai-afterschool-fsd
pnpm add @krdn/saju@github:krdn/saju#v1.0.0
```

- [ ] **Step 3: saju.ts 교체**

312줄 자체 구현을 `@krdn/saju` import로 교체:

```typescript
import { computeSajuChart, type SajuChart } from "@krdn/saju";

export function calculateSaju(
  birthDate: string,
  birthTime: string | undefined,
  gender: "M" | "F",
): SajuChart {
  return computeSajuChart({
    birthDate,
    birthTime,
    gender,
    calendar: "solar",
  });
}
```

기존 312줄의 십간십지·오행 균형·십성 자체 계산 로직 전부 제거.

- [ ] **Step 4: 호출부 수정**

`calculateSaju` 반환 타입이 바뀌므로, 이를 사용하는 파일들의 필드 접근 경로를 `SajuChart` 구조에 맞게 수정.

- [ ] **Step 5: 비교 테스트**

동일 입력(예: 1967-03-29 05:30 남성 solar)에 대해 기존 자체 구현과 `@krdn/saju` 계산 결과를 비교.

- [ ] **Step 6: typecheck + build + test**

```bash
pnpm typecheck && pnpm build && pnpm test
```

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "refactor: 사주 계산 엔진을 @krdn/saju 패키지로 교체"
```
