# gons-autopilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** gons-dashboard를 매주 1회 AI 주도로 리서치 → 5인 전문가 토론으로 최상위 1건 선정 → 무인 구현·머지·배포·검증·롤백까지 자동화한다.

**Architecture:** 배포 경계로 두 서브시스템 분리. **(A) 클라우드 사이클 엔진** = `scripts/autopilot/`의 Workflow 스크립트(리서치→토론→구현→PR→머지). **(B) 온프렘 배포 컨트롤러** = `apps/cron` 안의 deploy-watcher(새 `:sha-` 이미지 감지→`compose up --no-deps app`→health 게이트→실패 시 이전 sha 롤백). cron 컨테이너에 두는 이유: app을 재배포하면 self-kill이라 orchestrator가 그 바깥(cron)에 있어야 함.

**Tech Stack:** Node.js 24 (ESM), Workflow 도구(JS), Vitest, node-cron, docker CLI(compose v2), gh CLI, web-push, GitHub Actions, ghcr.io.

**참조 스펙:** `docs/superpowers/specs/2026-06-02-gons-autopilot-design.md`

---

## File Structure

```
scripts/autopilot/                       # 클라우드 사이클 엔진 (protected path)
├── schemas.js                           # CANDIDATE / CROSS_REVIEW / VERDICT JSON 스키마 (순수 객체)
├── protected-paths.js                   # 보호 경로 목록 + matchesProtectedPath(files)
├── score.js                             # computeScore(candidate, verdicts) + dedupKey 유틸
├── experts/
│   ├── dependency-security.md           # 전문가 프롬프트 5개
│   ├── code-architect.md
│   ├── product-strategist.md
│   ├── trend-researcher.md
│   └── ux-designer.md
├── cycle.workflow.js                    # 메인 Workflow 스크립트 (Workflow 도구로 실행)
└── README.md                            # 운영 가이드

apps/cron/
├── scheduler.js                         # (수정) autopilot deploy-watcher 등록 추가
├── Dockerfile                           # (수정) docker CLI 설치
└── autopilot/
    ├── lib.js                           # ghcr 조회·compose 실행·health 체크 순수 함수
    ├── deploy-watcher.js                # 폴링 루프 + 배포·검증·롤백 오케스트레이션
    └── lib.test.js                      # lib.js 단위 테스트

apps/cron/package.json                   # (수정) vitest devDependency 추가

docker-compose.yml                       # (수정) cron 서비스에 docker.sock 마운트 + env

tests/                                   # (대시보드 쪽) scripts/autopilot 단위 테스트
└── autopilot/
    ├── protected-paths.test.ts
    └── score.test.ts

autopilot-log.json                       # 사이클 이력 (append-only, 첫 생성은 [])
backlog.json                             # 미선정 후보 누적 (첫 생성은 [])
```

---

## Phase 0: 기반 — 스키마 / 보호경로 / 점수 (순수 함수, 테스트 가능)

이 Phase의 산출물은 클라우드·온프렘 양쪽에서 쓰는 순수 로직. DB·네트워크 없이 단위 테스트 가능.

### Task 1: 후보/검증 스키마 정의

**Files:**
- Create: `scripts/autopilot/schemas.js`

- [ ] **Step 1: 스키마 파일 작성**

```javascript
// scripts/autopilot/schemas.js
// autopilot 토론에서 에이전트가 반환하는 구조화 출력의 JSON Schema 정의.
// Workflow 도구의 agent(prompt, {schema}) 에 그대로 전달된다.

/** 라운드 1: 전문가가 제출하는 업그레이드 후보 */
export const CANDIDATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "rationale",
    "impact",
    "effort",
    "risk",
    "changeType",
    "protectedPathTouch",
    "dbMigration",
    "dedupKey",
    "touchedPaths",
  ],
  properties: {
    title: { type: "string", description: "한 줄 제목 (한국어)" },
    rationale: { type: "string", description: "왜 이 업그레이드가 가치 있는지" },
    impact: { type: "integer", minimum: 1, maximum: 5 },
    effort: { type: "integer", minimum: 1, maximum: 5 },
    risk: { type: "integer", minimum: 1, maximum: 5 },
    changeType: {
      type: "string",
      enum: ["deps", "security", "refactor", "feature", "ui", "perf"],
    },
    protectedPathTouch: { type: "boolean" },
    dbMigration: { type: "boolean" },
    dedupKey: {
      type: "string",
      description: "동일 후보 중복 판별용 안정 키 (예: 'deps:next-16.3')",
    },
    touchedPaths: {
      type: "array",
      items: { type: "string" },
      description: "이 후보가 수정할 것으로 예상되는 레포 상대 경로 glob 목록",
    },
  },
};

/** 전문가가 후보 N건을 한 번에 반환 */
export const CANDIDATE_LIST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: CANDIDATE_SCHEMA,
      maxItems: 3,
    },
  },
};

/** 라운드 2: 한 후보에 대한 타 전문가의 비판 */
export const CROSS_REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["challenge", "severity", "wouldBlock"],
  properties: {
    challenge: { type: "string", description: "이 후보의 약점·위험 (한국어)" },
    severity: { type: "string", enum: ["low", "medium", "high"] },
    wouldBlock: {
      type: "boolean",
      description: "이 후보를 이번 주에 진행하면 안 된다고 보는가",
    },
  },
};

/** 라운드 3: judge 한 명의 채점 */
export const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["valueScore", "safetyScore", "feasibilityScore", "reasoning"],
  properties: {
    valueScore: { type: "integer", minimum: 1, maximum: 5 },
    safetyScore: { type: "integer", minimum: 1, maximum: 5 },
    feasibilityScore: { type: "integer", minimum: 1, maximum: 5 },
    reasoning: { type: "string" },
  },
};
```

- [ ] **Step 2: 커밋**

```bash
git add scripts/autopilot/schemas.js
git commit -m "feat(autopilot): 후보/비판/판정 JSON 스키마 정의"
```

---

### Task 2: 보호 경로 매칭

**Files:**
- Create: `scripts/autopilot/protected-paths.js`
- Test: `tests/autopilot/protected-paths.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// tests/autopilot/protected-paths.test.ts
import { describe, it, expect } from "vitest";
// @ts-expect-error — JS 모듈 (타입 선언 없음)
import { matchesProtectedPath, PROTECTED_PATHS } from "../../scripts/autopilot/protected-paths.js";

describe("matchesProtectedPath", () => {
  it("워크플로 경로를 보호로 판정", () => {
    expect(matchesProtectedPath([".github/workflows/ci.yml"])).toBe(true);
  });

  it("cron 실행기 경로를 보호로 판정", () => {
    expect(matchesProtectedPath(["apps/cron/autopilot/deploy-watcher.js"])).toBe(true);
  });

  it("schema.ts (DB 마이그레이션) 를 보호로 판정", () => {
    expect(matchesProtectedPath(["apps/dashboard/src/shared/lib/db/schema.ts"])).toBe(true);
  });

  it("일반 위젯 파일은 보호 아님", () => {
    expect(matchesProtectedPath(["apps/dashboard/src/widgets/host-dashboard/ui/Foo.tsx"])).toBe(false);
  });

  it("빈 배열은 보호 아님", () => {
    expect(matchesProtectedPath([])).toBe(false);
  });

  it("PROTECTED_PATHS 는 비어있지 않다", () => {
    expect(PROTECTED_PATHS.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm --filter @gons/dashboard test tests/autopilot/protected-paths.test.ts`
Expected: FAIL — "Cannot find module '../../scripts/autopilot/protected-paths.js'"

- [ ] **Step 3: 구현**

```javascript
// scripts/autopilot/protected-paths.js
// 자율 머지가 건드리면 안 되는 경로 — 건드리면 needs-human 라벨 + 머지 보류.
// minimatch 없이 동작하도록 단순 prefix/suffix/contains 규칙으로 표현.

/** @type {{ kind: "prefix" | "suffix" | "contains" | "basename", value: string }[]} */
export const PROTECTED_PATHS = [
  { kind: "prefix", value: ".github/workflows/" },
  { kind: "prefix", value: "apps/cron/" },
  { kind: "prefix", value: "scripts/autopilot/" },
  { kind: "prefix", value: "drizzle/" },
  { kind: "contains", value: "/secrets/" },
  { kind: "contains", value: "autopilot" }, // specs/docs 의 autopilot 문서
  { kind: "basename", value: "docker-compose.yml" },
  { kind: "prefix", value: "apps/dashboard/src/app/api/health/" },
  { kind: "suffix", value: "/schema.ts" }, // DB 스키마 (prod 오염 위험)
  { kind: "suffix", value: ".env" },
  { kind: "contains", value: ".env." }, // .env.local 등
];

/**
 * @param {string} path 레포 상대 경로
 * @param {{ kind: string, value: string }} rule
 * @returns {boolean}
 */
function ruleMatches(path, rule) {
  switch (rule.kind) {
    case "prefix":
      return path.startsWith(rule.value);
    case "suffix":
      return path.endsWith(rule.value);
    case "contains":
      return path.includes(rule.value);
    case "basename":
      return path.split("/").pop() === rule.value;
    default:
      return false;
  }
}

/**
 * 변경된 파일 목록 중 하나라도 보호 경로면 true.
 * @param {string[]} files
 * @returns {boolean}
 */
export function matchesProtectedPath(files) {
  return files.some((f) => PROTECTED_PATHS.some((rule) => ruleMatches(f, rule)));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm --filter @gons/dashboard test tests/autopilot/protected-paths.test.ts`
Expected: PASS (6 passed)

- [ ] **Step 5: 커밋**

```bash
git add scripts/autopilot/protected-paths.js tests/autopilot/protected-paths.test.ts
git commit -m "feat(autopilot): 보호 경로 매칭 + 단위 테스트"
```

---

### Task 3: 합의 점수 계산

**Files:**
- Create: `scripts/autopilot/score.js`
- Test: `tests/autopilot/score.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// tests/autopilot/score.test.ts
import { describe, it, expect } from "vitest";
// @ts-expect-error — JS 모듈
import { computeScore } from "../../scripts/autopilot/score.js";

const baseVerdicts = [
  { valueScore: 4, safetyScore: 4, feasibilityScore: 4, reasoning: "" },
  { valueScore: 4, safetyScore: 4, feasibilityScore: 4, reasoning: "" },
  { valueScore: 4, safetyScore: 4, feasibilityScore: 4, reasoning: "" },
];

describe("computeScore", () => {
  it("보호경로/마이그레이션 없는 후보는 페널티 없음", () => {
    const candidate = { protectedPathTouch: false, dbMigration: false };
    const score = computeScore(candidate, baseVerdicts);
    // value 4*0.4 + safety 4*0.35 + feasibility 4*0.25 = 4.0
    expect(score).toBeCloseTo(4.0, 5);
  });

  it("보호경로 후보는 큰 페널티", () => {
    const clean = computeScore({ protectedPathTouch: false, dbMigration: false }, baseVerdicts);
    const protectedC = computeScore({ protectedPathTouch: true, dbMigration: false }, baseVerdicts);
    expect(protectedC).toBeLessThan(clean);
    expect(clean - protectedC).toBeCloseTo(2.0, 5); // PROTECTED_PENALTY
  });

  it("DB 마이그레이션 후보는 추가 페널티", () => {
    const protectedOnly = computeScore({ protectedPathTouch: true, dbMigration: false }, baseVerdicts);
    const both = computeScore({ protectedPathTouch: true, dbMigration: true }, baseVerdicts);
    expect(both).toBeLessThan(protectedOnly);
  });

  it("verdict 가 없으면 0 반환 (분모 0 방지)", () => {
    expect(computeScore({ protectedPathTouch: false, dbMigration: false }, [])).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm --filter @gons/dashboard test tests/autopilot/score.test.ts`
Expected: FAIL — "Cannot find module"

- [ ] **Step 3: 구현**

```javascript
// scripts/autopilot/score.js
// judge 패널의 평결을 평균내어 후보 점수 산출. 보호경로/마이그레이션 페널티 적용.

const PROTECTED_PENALTY = 2.0;
const DB_MIGRATION_PENALTY = 1.5;

/**
 * @param {{ protectedPathTouch: boolean, dbMigration: boolean }} candidate
 * @param {{ valueScore: number, safetyScore: number, feasibilityScore: number }[]} verdicts
 * @returns {number}
 */
export function computeScore(candidate, verdicts) {
  if (!verdicts || verdicts.length === 0) return 0;
  const n = verdicts.length;
  const avgValue = verdicts.reduce((s, v) => s + v.valueScore, 0) / n;
  const avgSafety = verdicts.reduce((s, v) => s + v.safetyScore, 0) / n;
  const avgFeasibility = verdicts.reduce((s, v) => s + v.feasibilityScore, 0) / n;

  let score = avgValue * 0.4 + avgSafety * 0.35 + avgFeasibility * 0.25;
  if (candidate.protectedPathTouch) score -= PROTECTED_PENALTY;
  if (candidate.dbMigration) score -= DB_MIGRATION_PENALTY;
  return score;
}

/**
 * backlog 중복 판별: dedupKey 가 이미 backlog 에 있으면 true.
 * @param {string} dedupKey
 * @param {{ dedupKey: string }[]} backlog
 * @returns {boolean}
 */
export function isDuplicate(dedupKey, backlog) {
  return backlog.some((b) => b.dedupKey === dedupKey);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm --filter @gons/dashboard test tests/autopilot/score.test.ts`
Expected: PASS (4 passed)

- [ ] **Step 5: 커밋**

```bash
git add scripts/autopilot/score.js tests/autopilot/score.test.ts
git commit -m "feat(autopilot): 합의 점수 계산 + dedup 유틸 + 테스트"
```

---

## Phase 1: 전문가 프롬프트 (리서치 에이전트 정의)

### Task 4: 전문가 프롬프트 5개 작성

**Files:**
- Create: `scripts/autopilot/experts/dependency-security.md`
- Create: `scripts/autopilot/experts/code-architect.md`
- Create: `scripts/autopilot/experts/product-strategist.md`
- Create: `scripts/autopilot/experts/trend-researcher.md`
- Create: `scripts/autopilot/experts/ux-designer.md`

각 프롬프트는 cycle.workflow.js 가 읽어 `agent(prompt, {agentType, schema: CANDIDATE_LIST_SCHEMA})` 로 주입한다. 공통 규칙: ① 읽기 전용 리서치만, ② 후보 1~3건, ③ touchedPaths 에 예상 수정 경로를 정직하게, ④ protectedPathTouch/dbMigration 을 보수적으로 표시(애매하면 true).

- [ ] **Step 1: dependency-security.md 작성**

```markdown
# 전문가: 의존성·보안

당신은 gons-dashboard 의 의존성·보안 전문가다. 이번 주 가장 가치 있는 업그레이드 후보를 1~3건 제안하라.

## 리서치 절차 (읽기 전용)
1. `cat package.json apps/dashboard/package.json apps/cron/package.json` 로 의존성 파악
2. `pnpm --filter @gons/dashboard outdated` 로 outdated 목록 (실패해도 무시하고 package.json 기준으로 판단)
3. Context7 로 주요 라이브러리(next, drizzle-orm, next-auth) 의 최신 안정 버전·breaking change 확인
4. 웹검색으로 사용 중인 버전의 알려진 CVE 확인

## 출력 규칙
- 각 후보에 impact/effort/risk (1-5) 를 매겨라. 보안 패치는 impact 높게.
- 메이저 버전 업(breaking) 은 risk 4-5.
- touchedPaths: 보통 `apps/dashboard/package.json`, `pnpm-lock.yaml`. 코드 수정 동반 시 해당 경로도.
- protectedPathTouch: package.json 만 건드리면 false. 단 워크플로/compose 수정 동반 시 true.
- dbMigration: 거의 항상 false (의존성 업은 마이그레이션 아님).
- dedupKey: `deps:<패키지>-<목표버전>` (예: `deps:next-16.3`).

CANDIDATE_LIST_SCHEMA 형식의 JSON 으로만 반환하라.
```

- [ ] **Step 2: code-architect.md 작성**

```markdown
# 전문가: 코드 품질·아키텍처

당신은 gons-dashboard 의 FSD 아키텍처·코드 품질 전문가다. 이번 주 리팩터링/품질 개선 후보를 1~3건 제안하라.

## 리서치 절차 (읽기 전용)
1. `cat CLAUDE.md` 의 "FSD 아키텍처" + "Gotcha" 섹션 정독 — 기존 패턴·함정 숙지
2. 800줄 초과 파일 탐색: `find apps/dashboard/src -name '*.ts' -o -name '*.tsx' | xargs wc -l | sort -rn | head -20`
3. `pnpm --filter @gons/dashboard lint` 출력에서 FSD boundary 위반 확인 (실패해도 출력 분석)
4. features/entities barrel server/client seam (Gotcha #1, #7) 위반 의심 지점 Grep

## 출력 규칙
- 큰 파일 분해, 중복 제거, FSD 경계 정리, 테스트 커버리지 보강 등.
- effort 는 영향 파일 수에 비례. risk 는 런타임 동작 변경 위험.
- touchedPaths: 실제 수정 대상 경로. 광범위 리팩터는 여러 경로.
- protectedPathTouch: apps/cron, .github, schema.ts 등 건드리면 true.
- dbMigration: schema.ts/drizzle 건드리면 true.
- dedupKey: `refactor:<대상-요약>` (예: `refactor:split-stocks-page`).

CANDIDATE_LIST_SCHEMA 형식의 JSON 으로만 반환하라.
```

- [ ] **Step 3: product-strategist.md 작성**

```markdown
# 전문가: 제품 전략

당신은 gons-dashboard 의 제품 전략가다. 이번 주 가장 가치 있는 신규 기능/도메인 후보를 1~3건 제안하라.

## 리서치 절차 (읽기 전용)
1. `cat CLAUDE.md` 의 "프로젝트 개요" — 현재 도메인·확장 방향(할 일, 노트 등) 파악
2. `cat TODOS.md` — v0.2 후보 백로그 정독, 가치·의존성 평가
3. `cat docs/agents/domain.md` (있으면) — 도메인 결정·용어
4. 기존 위젯/페이지 구조 파악: `ls apps/dashboard/src/widgets apps/dashboard/src/app`

## 출력 규칙
- TODOS.md 항목 구현 또는 CLAUDE.md 확장 방향의 1차 위젯 등.
- 신규 도메인은 effort 높게(4-5), risk 는 기존 시스템 영향도.
- touchedPaths: 신규 feature/entity/widget 경로 + 라우트.
- protectedPathTouch: 보통 false. schema 신규 추가 시 dbMigration=true.
- dbMigration: 새 테이블 필요하면 true (→ 무인 머지에서 제외됨을 인지).
- dedupKey: `feature:<도메인-요약>` (예: `feature:todo-widget-v1`).

CANDIDATE_LIST_SCHEMA 형식의 JSON 으로만 반환하라.
```

- [ ] **Step 4: trend-researcher.md 작성**

```markdown
# 전문가: 업계 트렌드

당신은 웹·프론트엔드 생태계 트렌드 리서처다. gons-dashboard 에 적용 가능한 최신 동향 후보를 1~3건 제안하라.

## 리서치 절차 (읽기 전용)
1. `cat CLAUDE.md` 의 "기술 스택" — 현재 스택(Next.js 16, Drizzle, TanStack Query, Zustand) 파악
2. WebSearch/Exa 로 해당 스택의 최신 권장 패턴·마이그레이션 가이드 조사
3. 적용 시 실익이 분명한 것만. "유행이라서"는 배제.

## 출력 규칙
- 검증된 마이그레이션·신패턴만. 실험적/불안정은 risk 5.
- 트렌드는 impact 를 보수적으로(과대평가 금지).
- touchedPaths: 적용 대상 경로.
- protectedPathTouch / dbMigration: 해당 시 정직하게 true.
- dedupKey: `trend:<주제>` (예: `trend:tanstack-query-v6`).

CANDIDATE_LIST_SCHEMA 형식의 JSON 으로만 반환하라.
```

- [ ] **Step 5: ux-designer.md 작성**

```markdown
# 전문가: UI/UX 디자인

당신은 gons-dashboard 의 UI/UX 디자인 전문가다. 이번 주 시각·상호작용 품질을 최고로 끌어올릴 후보를 1~3건 제안하라.

## 리서치 절차 (읽기 전용)
1. `cat CLAUDE.md` 의 "스타일링" — Tailwind v4 + 라이트모드 고정 + 디자인 토큰(globals.css) 제약 숙지
2. `~/.claude/rules/ecc/web/design-quality.md` 의 anti-template 정책·required qualities 적용
3. 가능하면 라이브 사이트(http://localhost:3020 또는 https://gons.krdn.kr) 스크린샷으로 현 상태 진단
4. 위젯/페이지의 시각 계층·여백 리듬·상태(hover/focus) 점검

## 출력 규칙
- 디자인 토큰 체계 안에서의 개선. 라이트모드 고정 제약 위반 금지.
- 전면 개편은 effort 높게. 점진 개선 우선.
- touchedPaths: 컴포넌트 + globals.css 등.
- protectedPathTouch: 보통 false.
- dbMigration: false.
- dedupKey: `ui:<대상-요약>` (예: `ui:dashboard-visual-hierarchy`).

CANDIDATE_LIST_SCHEMA 형식의 JSON 으로만 반환하라.
```

- [ ] **Step 6: 커밋**

```bash
git add scripts/autopilot/experts/
git commit -m "feat(autopilot): 전문가 프롬프트 5개 (의존성/아키텍처/제품/트렌드/UX)"
```

---

## Phase 2: 사이클 Workflow 스크립트 (리서치 → 토론 → 선정 → 구현 → PR)

### Task 5: cycle.workflow.js — 리서치 + 토론 + 선정 (shadow 까지)

**Files:**
- Create: `scripts/autopilot/cycle.workflow.js`

이 스크립트는 **Workflow 도구**로 실행된다(일반 node 실행 아님). `agent()`/`parallel()`/`pipeline()` 훅을 쓴다. `args` 로 `{ mode, isoWeek, nowIso }` 를 받는다.

- [ ] **Step 1: 스크립트 작성 (리서치+토론+선정 부분)**

```javascript
// scripts/autopilot/cycle.workflow.js
// Workflow 도구로 실행되는 autopilot 주간 사이클.
// 호출: Workflow({ scriptPath: "scripts/autopilot/cycle.workflow.js", args: { mode, isoWeek, nowIso } })
//
// args = { mode: "shadow" | "autonomous", isoWeek: "2026-W23", nowIso: "2026-06-02T09:00:00+09:00" }

export const meta = {
  name: "autopilot-cycle",
  description: "주간 자율 업그레이드: 5인 전문가 리서치→토론→최상위 1건 선정→구현→PR",
  phases: [
    { title: "Research" },
    { title: "CrossReview" },
    { title: "Judge" },
    { title: "Implement" },
    { title: "PR" },
  ],
};

import { CANDIDATE_LIST_SCHEMA, CROSS_REVIEW_SCHEMA, VERDICT_SCHEMA } from "./schemas.js";
import { matchesProtectedPath } from "./protected-paths.js";
import { computeScore } from "./score.js";

const EXPERTS = [
  { key: "dependency-security", agentType: "security-reviewer" },
  { key: "code-architect", agentType: "code-architect" },
  { key: "product-strategist", agentType: "planner" },
  { key: "trend-researcher", agentType: "researcher" },
  { key: "ux-designer", agentType: "general-purpose" },
];

const mode = args?.mode ?? "shadow";
const isoWeek = args?.isoWeek ?? "unknown-week";

// --- 라운드 1: 제안 (병렬 fan-out) ---
phase("Research");
log(`autopilot ${isoWeek} (${mode}) — 5인 전문가 리서치 시작`);

const proposals = await parallel(
  EXPERTS.map((e) => async () => {
    const promptFile = `scripts/autopilot/experts/${e.key}.md`;
    const result = await agent(
      `다음 전문가 지시를 따라 후보를 제안하라. 지시 파일: ${promptFile}\n` +
        `먼저 그 파일을 Read 로 읽고, 절차대로 리서치한 뒤 스키마 형식으로 반환하라.`,
      { label: `research:${e.key}`, phase: "Research", agentType: e.agentType, schema: CANDIDATE_LIST_SCHEMA },
    );
    return (result?.candidates ?? []).map((c) => ({ ...c, owner: e.key }));
  }),
);

const allCandidates = proposals.filter(Boolean).flat();
log(`후보 ${allCandidates.length}건 수집`);
if (allCandidates.length === 0) {
  return { isoWeek, mode, selected: null, reason: "no-candidates", candidates: [] };
}

// touchedPaths 기반으로 protectedPathTouch 재확정 (전문가 자가신고를 코드로 검증)
for (const c of allCandidates) {
  if (matchesProtectedPath(c.touchedPaths ?? [])) c.protectedPathTouch = true;
}

// --- 라운드 2: 상호 비판 ---
phase("CrossReview");
const reviewed = await pipeline(
  allCandidates,
  async (candidate, _orig, idx) => {
    // 다른 전문가들이 이 후보를 비판
    const reviewers = EXPERTS.filter((e) => e.key !== candidate.owner);
    const reviews = await parallel(
      reviewers.map((r) => async () =>
        agent(
          `너는 '${r.key}' 관점의 전문가다. 아래 업그레이드 후보를 네 영역 관점에서 비판하라.\n\n` +
            `제목: ${candidate.title}\n근거: ${candidate.rationale}\n` +
            `변경유형: ${candidate.changeType} / 예상경로: ${(candidate.touchedPaths ?? []).join(", ")}\n\n` +
            `약점·위험을 찾아 스키마 형식으로 반환하라.`,
          { label: `review:${idx}:${r.key}`, phase: "CrossReview", agentType: r.agentType, schema: CROSS_REVIEW_SCHEMA },
        ),
      ),
    );
    return { ...candidate, crossReview: reviews.filter(Boolean) };
  },
);

// --- 라운드 3: judge 패널 채점 ---
phase("Judge");
const LENSES = ["가치(value)", "안전(safety)", "실현성(feasibility)"];
const judged = await pipeline(
  reviewed,
  async (candidate, _orig, idx) => {
    const reviewSummary = (candidate.crossReview ?? [])
      .map((r) => `- [${r.severity}${r.wouldBlock ? "/BLOCK" : ""}] ${r.challenge}`)
      .join("\n");
    const verdicts = await parallel(
      LENSES.map((lens) => async () =>
        agent(
          `너는 '${lens}' 렌즈의 독립 심사위원이다. 아래 후보를 채점하라.\n\n` +
            `제목: ${candidate.title}\n근거: ${candidate.rationale}\n` +
            `impact=${candidate.impact} effort=${candidate.effort} risk=${candidate.risk}\n` +
            `보호경로건드림=${candidate.protectedPathTouch} DB마이그레이션=${candidate.dbMigration}\n\n` +
            `타 전문가 비판:\n${reviewSummary || "(없음)"}\n\n` +
            `valueScore/safetyScore/feasibilityScore (1-5) 와 reasoning 을 반환하라.`,
          { label: `judge:${idx}:${lens}`, phase: "Judge", agentType: "general-purpose", schema: VERDICT_SCHEMA },
        ),
      ),
    );
    const verdictList = verdicts.filter(Boolean);
    return { ...candidate, verdicts: verdictList, score: computeScore(candidate, verdictList) };
  },
);

// 최상위 1건 선정
const ranked = judged.filter(Boolean).sort((a, b) => b.score - a.score);
const selected = ranked[0] ?? null;
const backlog = ranked.slice(1);

log(`선정: ${selected ? `${selected.title} (score=${selected.score.toFixed(2)})` : "없음"}`);

// 이 단계에서 일단 선정 결과를 반환. 구현/PR 은 Task 6 에서 추가.
return {
  isoWeek,
  mode,
  selected,
  backlog,
  candidateCount: allCandidates.length,
};
```

- [ ] **Step 2: 문법 검증**

Run: `node --check scripts/autopilot/cycle.workflow.js`
Expected: 출력 없음 (문법 OK). 만약 `Cannot use import statement outside a module` 류 경고면 무시 — Workflow 런타임이 ESM 으로 평가함. `node --check` 가 통과하면 충분.

> 참고: 이 파일은 Workflow 도구 전용이라 직접 실행하지 않는다. 실제 검증은 Task 12(shadow 1회 실행)에서 한다. 여기서는 문법만 확인.

- [ ] **Step 3: 커밋**

```bash
git add scripts/autopilot/cycle.workflow.js
git commit -m "feat(autopilot): 사이클 Workflow — 리서치+상호비판+judge 선정"
```

---

### Task 6: cycle.workflow.js — 구현 + PR + 로그 기록

**Files:**
- Modify: `scripts/autopilot/cycle.workflow.js` (마지막 `return` 블록 교체)

- [ ] **Step 1: 선정 후 구현·PR·로그 로직 추가**

기존 Task 5 의 마지막 `return { isoWeek, mode, selected, backlog, candidateCount };` 블록을 아래로 교체:

```javascript
// 선정 결과 로그 골격 (shadow/autonomous 공통)
const nowIso = args?.nowIso ?? "unknown-time"; // Workflow 런타임은 argless new Date() 금지 → args 로 받음

const logEntry = {
  id: `autopilot-${isoWeek}`,
  date: nowIso,
  mode,
  candidateCount: allCandidates.length,
  selected: selected
    ? { title: selected.title, owner: selected.owner, score: selected.score, changeType: selected.changeType }
    : null,
  backlogTop3: backlog.slice(0, 3).map((b) => ({ title: b.title, score: b.score, dedupKey: b.dedupKey })),
};

if (!selected) {
  return { ...logEntry, prUrl: null, reason: "no-candidate-selected" };
}

// 보호경로/DB마이그레이션 후보는 PR 만 만들고 needs-human (무인 머지 금지)
const needsHuman = selected.protectedPathTouch || selected.dbMigration;
const slug = selected.dedupKey.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40);
const branch = `autopilot/${isoWeek}-${slug}`;

// --- 구현 페이즈 ---
phase("Implement");
const implResult = await agent(
  `너는 구현 엔지니어다. 다음 업그레이드를 gons-dashboard 에 구현하라.\n\n` +
    `제목: ${selected.title}\n근거: ${selected.rationale}\n예상경로: ${(selected.touchedPaths ?? []).join(", ")}\n\n` +
    `규칙:\n` +
    `1. 새 브랜치 '${branch}' 를 최신 main 에서 생성 (git fetch origin main; git checkout -b ${branch} origin/main)\n` +
    `2. TDD: 가능하면 테스트 먼저. CLAUDE.md 의 FSD·Gotcha 규칙 준수.\n` +
    `3. 게이트 필수 통과: pnpm typecheck && pnpm lint && (cd apps/dashboard && pnpm build)\n` +
    `4. 게이트 실패 시 최대 2회 자가수정. 그래도 실패면 gateGreen=false 로 반환하고 push 하지 마라.\n` +
    `5. 성공 시 git push -u origin ${branch}.\n\n` +
    `결과를 JSON 으로 반환하라.`,
  {
    label: `implement:${slug}`,
    phase: "Implement",
    agentType: "coder",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["gateGreen", "pushed", "summary", "filesChanged"],
      properties: {
        gateGreen: { type: "boolean" },
        pushed: { type: "boolean" },
        summary: { type: "string" },
        filesChanged: { type: "array", items: { type: "string" } },
      },
    },
  },
);

if (!implResult?.gateGreen || !implResult?.pushed) {
  return { ...logEntry, prUrl: null, reason: "implementation-gate-failed", impl: implResult };
}

// 실제 변경 파일로 보호경로 최종 재확인 (구현이 예상 밖 파일을 건드렸을 수 있음)
const actuallyProtected = matchesProtectedPath(implResult.filesChanged ?? []);
const finalNeedsHuman = needsHuman || actuallyProtected;

// --- PR 생성 (+ shadow 면 머지 안 함) ---
phase("PR");
const prInstruction =
  finalNeedsHuman
    ? `이 PR 은 보호경로/DB마이그레이션을 건드리므로 'needs-human' 라벨을 붙이고 머지하지 마라.`
    : mode === "autonomous"
      ? `머지 전 'gh pr view --json mergeable' 로 충돌 확인. mergeable 이면 'gh pr merge --squash --delete-branch' 로 머지하라. 충돌이면 'needs-human' 라벨만 붙이고 머지 보류.`
      : `shadow 모드다. 머지하지 말고 PR 만 생성하라.`;

const prResult = await agent(
  `브랜치 '${branch}' 로 PR 을 생성하라 (gh pr create, base=main).\n` +
    `제목: "autopilot(${isoWeek}): ${selected.title}"\n` +
    `본문에 근거·변경요약(${implResult.summary})·자동생성 표기.\n` +
    `${prInstruction}\n` +
    `결과를 JSON 으로 반환하라.`,
  {
    label: `pr:${slug}`,
    phase: "PR",
    agentType: "general-purpose",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["prUrl", "merged", "label"],
      properties: {
        prUrl: { type: "string" },
        merged: { type: "boolean" },
        label: { type: "string" },
      },
    },
  },
);

return {
  ...logEntry,
  branch,
  prUrl: prResult?.prUrl ?? null,
  merged: prResult?.merged ?? false,
  needsHuman: finalNeedsHuman,
  impl: { summary: implResult.summary, filesChanged: implResult.filesChanged },
};
```

- [ ] **Step 2: 문법 검증**

Run: `node --check scripts/autopilot/cycle.workflow.js`
Expected: 출력 없음 (문법 OK)

- [ ] **Step 3: 커밋**

```bash
git add scripts/autopilot/cycle.workflow.js
git commit -m "feat(autopilot): 구현+PR+머지 페이즈 (shadow/autonomous 분기, needs-human 가드)"
```

---

## Phase 3: 온프렘 배포 컨트롤러 (cron 안에서 app 재배포·검증·롤백)

### Task 7: deploy 라이브러리 + 단위 테스트

**Files:**
- Create: `apps/cron/autopilot/lib.js`
- Create: `apps/cron/autopilot/lib.test.js`
- Modify: `apps/cron/package.json` (vitest devDependency)

- [ ] **Step 1: package.json 에 vitest 추가**

`apps/cron/package.json` 을 아래로 교체:

```json
{
  "name": "gons-dashboard-cron",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "node-cron": "^3.0.3"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: 실패 테스트 작성**

```javascript
// apps/cron/autopilot/lib.test.js
import { describe, it, expect } from "vitest";
import { parseHealthBody, shouldDeploy, buildDeployArgs, buildRollbackArgs } from "./lib.js";

describe("parseHealthBody", () => {
  it("status ok 면 healthy", () => {
    expect(parseHealthBody('{"status":"ok","time":"2026-06-02T00:00:00.000Z"}')).toBe(true);
  });
  it("status error 면 unhealthy", () => {
    expect(parseHealthBody('{"status":"error","message":"db down"}')).toBe(false);
  });
  it("파싱 불가면 unhealthy", () => {
    expect(parseHealthBody("<html>502</html>")).toBe(false);
  });
});

describe("shouldDeploy", () => {
  it("새 sha 가 running 과 다르면 배포", () => {
    expect(shouldDeploy("sha-new", "sha-old", null)).toBe(true);
  });
  it("새 sha 가 running 과 같으면 스킵", () => {
    expect(shouldDeploy("sha-x", "sha-x", null)).toBe(false);
  });
  it("이미 롤백한 sha 는 재배포 안 함", () => {
    expect(shouldDeploy("sha-bad", "sha-old", "sha-bad")).toBe(false);
  });
  it("latest 가 없으면 배포 안 함", () => {
    expect(shouldDeploy(null, "sha-old", null)).toBe(false);
  });
});

describe("buildDeployArgs", () => {
  it("절대경로 -f / --env-file / --no-deps app 을 포함", () => {
    const a = buildDeployArgs("/abs/docker-compose.yml", "/abs/.env");
    expect(a).toEqual([
      "compose", "-f", "/abs/docker-compose.yml", "--env-file", "/abs/.env",
      "up", "-d", "--no-deps", "app",
    ]);
  });
});

describe("buildRollbackArgs", () => {
  it("롤백도 동일 구조 (env 로 APP_IMAGE_TAG 주입)", () => {
    const a = buildRollbackArgs("/abs/docker-compose.yml", "/abs/.env");
    expect(a).toEqual([
      "compose", "-f", "/abs/docker-compose.yml", "--env-file", "/abs/.env",
      "up", "-d", "--no-deps", "app",
    ]);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd apps/cron && pnpm install && pnpm test`
Expected: FAIL — "Cannot find module './lib.js'" 또는 export 누락

- [ ] **Step 4: lib.js 구현**

```javascript
// apps/cron/autopilot/lib.js
// 순수/얇은 함수 — 배포 판단·명령 인자 조립·health 파싱. docker 실행은 deploy-watcher.js 가 담당.

/**
 * /api/health 응답 본문이 healthy 인지.
 * @param {string} body
 * @returns {boolean}
 */
export function parseHealthBody(body) {
  try {
    const json = JSON.parse(body);
    return json.status === "ok";
  } catch {
    return false;
  }
}

/**
 * 새 이미지 태그를 배포해야 하는가.
 * @param {string|null} latestSha   ghcr 의 최신 sha 태그 (예: "sha-abc123")
 * @param {string|null} runningSha 현재 떠있는 app 의 sha 태그
 * @param {string|null} rolledBackSha 직전에 롤백 처리한 sha (재배포 차단용)
 * @returns {boolean}
 */
export function shouldDeploy(latestSha, runningSha, rolledBackSha) {
  if (!latestSha) return false;
  if (latestSha === runningSha) return false;
  if (latestSha === rolledBackSha) return false;
  return true;
}

/**
 * compose up 인자 (Gotcha #8: 절대경로 명시 / --no-deps: postgres recreate 방지).
 * 배포할 태그는 호출자가 APP_IMAGE_TAG 환경변수로 주입한다.
 * @param {string} composePath
 * @param {string} envPath
 * @returns {string[]}
 */
export function buildDeployArgs(composePath, envPath) {
  return ["compose", "-f", composePath, "--env-file", envPath, "up", "-d", "--no-deps", "app"];
}

/** 롤백도 동일 구조 — 차이는 호출자가 주입하는 APP_IMAGE_TAG 값뿐. */
export function buildRollbackArgs(composePath, envPath) {
  return buildDeployArgs(composePath, envPath);
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd apps/cron && pnpm test`
Expected: PASS (11 passed)

- [ ] **Step 6: 커밋**

```bash
git add apps/cron/autopilot/lib.js apps/cron/autopilot/lib.test.js apps/cron/package.json
git commit -m "feat(autopilot): cron 배포 lib (health 파싱·배포 판단·compose 인자) + 테스트"
```

---

### Task 8: deploy-watcher — 폴링·배포·검증·롤백 오케스트레이션

**Files:**
- Create: `apps/cron/autopilot/deploy-watcher.js`

이 모듈은 docker CLI 를 `child_process.execFile` 로 호출하므로 단위 테스트 대신 Task 11(수동 통합)에서 검증한다. 로직은 Task 7 의 테스트된 lib.js 함수에 위임한다.

- [ ] **Step 1: deploy-watcher.js 구현**

```javascript
// apps/cron/autopilot/deploy-watcher.js
// cron 컨테이너 안에서 도는 무인 배포 컨트롤러.
// ghcr 의 새 :sha- 태그 감지 → APP_IMAGE_TAG 핀 배포 → health 게이트 → 실패 시 이전 sha 롤백.
//
// 왜 cron 인가: app 을 재배포하면 self-kill. orchestrator 는 그 바깥(cron)에 있어야 한다.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { parseHealthBody, shouldDeploy, buildDeployArgs } from "./lib.js";

const execFileAsync = promisify(execFile);

const COMPOSE_PATH =
  process.env.AUTOPILOT_COMPOSE_PATH ?? "/home/gon/projects/gon/gons-dashboard/docker-compose.yml";
const ENV_PATH = process.env.AUTOPILOT_ENV_PATH ?? "/home/gon/projects/gon/gons-dashboard/.env";
const APP_URL = process.env.APP_URL ?? "http://app:3020";
const DOCKER_CONTEXT = process.env.AUTOPILOT_DOCKER_CONTEXT ?? "default";
const TARGET_FILE = process.env.AUTOPILOT_TARGET_FILE ?? "/signal/.autopilot-target";
const HEALTH_TIMEOUT_MS = 90_000;
const HEALTH_POLL_MS = 5_000;

// 롤백 차단용 (메모리 상태 — 컨테이너 재시작 시 초기화돼도 안전: 다음 폴링이 running 과 비교)
let rolledBackSha = null;

async function docker(args) {
  const { stdout } = await execFileAsync("docker", ["--context", DOCKER_CONTEXT, ...args], {
    timeout: 120_000,
  });
  return stdout.trim();
}

/** 현재 떠있는 app 컨테이너가 어떤 sha 태그로 떴는지. */
async function getRunningSha() {
  try {
    const ref = await docker(["inspect", "--format", "{{.Config.Image}}", "gons-dashboard-app"]);
    const m = ref.match(/:(sha-[0-9a-f]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** GHA 가 머지 시 기록한 최신 sha 신호 파일을 읽는다 (registry 인증·digest 매핑 회피). */
async function getLatestSha() {
  try {
    const target = (await readFile(TARGET_FILE, "utf8")).trim();
    return target || null;
  } catch {
    return null;
  }
}

async function checkHealth() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${APP_URL}/api/health`);
      const body = await res.text();
      if (res.ok && parseHealthBody(body)) {
        // 핵심 라우트 smoke
        const login = await fetch(`${APP_URL}/login`);
        const cronRoute = await fetch(`${APP_URL}/api/cron/poll-gmail`, { method: "POST" });
        if (login.status === 200 && cronRoute.status === 401) return true;
      }
    } catch {
      // 아직 안 떴음 — 재시도
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
  }
  return false;
}

async function deployTag(sha) {
  const cmdArgs = buildDeployArgs(COMPOSE_PATH, ENV_PATH);
  await execFileAsync("docker", ["--context", DOCKER_CONTEXT, ...cmdArgs], {
    timeout: 180_000,
    env: { ...process.env, APP_IMAGE_TAG: sha },
  });
}

async function notify(title, message) {
  try {
    await fetch(`${APP_URL}/api/cron/autopilot-notify`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CRON_BEARER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, message }),
    });
  } catch (e) {
    console.error("[autopilot] notify 실패", e);
  }
}

export async function runDeployCycle() {
  const runningSha = await getRunningSha();
  const latestSha = await getLatestSha();

  if (!shouldDeploy(latestSha, runningSha, rolledBackSha)) {
    console.log(
      `[autopilot] 배포 불필요 (latest=${latestSha} running=${runningSha} rolledBack=${rolledBackSha})`,
    );
    return;
  }

  console.log(`[autopilot] 새 이미지 ${latestSha} 감지 — 배포 시작 (현재 ${runningSha})`);
  const goodSha = runningSha; // 롤백 대상 = 직전 정상 sha

  try {
    await deployTag(latestSha);
    const healthy = await checkHealth();
    if (healthy) {
      rolledBackSha = null;
      console.log(`[autopilot] 배포 성공 ${latestSha}`);
      await notify("autopilot 배포 성공", `${latestSha} 배포 완료 (health OK)`);
      return;
    }
    throw new Error("health gate failed");
  } catch (err) {
    console.error(`[autopilot] 배포 실패 — 롤백 시도`, err);
    rolledBackSha = latestSha; // 이 sha 는 다음 폴링에서 재배포 차단
    if (goodSha) {
      try {
        await deployTag(goodSha);
        const ok = await checkHealth();
        await notify(
          "autopilot 배포 실패 → 롤백",
          `${latestSha} health 실패. ${goodSha} 로 롤백 ${ok ? "성공" : "했으나 health 미확인"}.`,
        );
      } catch (rbErr) {
        await notify("autopilot 롤백 실패", `${latestSha} 실패 후 ${goodSha} 롤백도 실패. 수동 개입 필요.`);
        console.error("[autopilot] 롤백 실패", rbErr);
      }
    } else {
      await notify("autopilot 배포 실패", `${latestSha} health 실패. 이전 sha 미상 — 수동 개입 필요.`);
    }
  }
}
```

> 설계 노트: 최신 sha 신호를 registry manifest 조회 대신 **파일 신호**(`.autopilot-target`)로 받는다. GHA docker job 이 머지 시 sha 를 알고 있으므로 그 값을 온프렘이 읽을 수 있는 곳에 기록한다(Task 10). registry 인증·digest↔sha 매핑 복잡도를 피하는 가장 견고한 방법.

- [ ] **Step 2: 문법 검증**

Run: `node --check apps/cron/autopilot/deploy-watcher.js`
Expected: 출력 없음

- [ ] **Step 3: 커밋**

```bash
git add apps/cron/autopilot/deploy-watcher.js
git commit -m "feat(autopilot): deploy-watcher — sha 핀 배포·health 게이트·자동 롤백"
```

---

### Task 9: scheduler.js 에 deploy-watcher 등록 + Dockerfile docker CLI + compose 마운트

**Files:**
- Modify: `apps/cron/scheduler.js`
- Modify: `apps/cron/Dockerfile`
- Modify: `docker-compose.yml`

- [ ] **Step 1: scheduler.js 에 deploy-watcher 등록 추가**

`apps/cron/scheduler.js` 의 `import cron from "node-cron";` 바로 다음 줄에 추가:

```javascript
import { runDeployCycle } from "./autopilot/deploy-watcher.js";
```

그리고 파일 맨 끝 `console.log("[cron] 스케줄 등록 완료...")` **앞**에 추가:

```javascript
// autopilot — 5분 주기로 새 이미지 감지·배포·검증·롤백 (AUTOPILOT_DEPLOY=on 일 때만).
if (process.env.AUTOPILOT_DEPLOY === "on") {
  cron.schedule(
    "*/5 * * * *",
    () => {
      void runDeployCycle();
    },
    { timezone: TIMEZONE },
  );
  console.log("[cron] autopilot deploy-watcher 등록 (*/5 * * * *)");
}
```

- [ ] **Step 2: Dockerfile 에 docker CLI 설치 + autopilot 복사**

`apps/cron/Dockerfile` 의 `RUN apk add --no-cache tzdata curl && \` 줄을 아래로 교체:

```dockerfile
RUN apk add --no-cache tzdata curl docker-cli docker-cli-compose && \
```

`COPY scheduler.js ./` 줄을 아래 두 줄로 교체:

```dockerfile
COPY scheduler.js ./
COPY autopilot ./autopilot
```

> 주의: `USER node` 가 docker.sock 에 접근하려면 socket 그룹 권한이 필요. 운영 socket 이 root:docker 면 node 유저 권한 부족 가능. Task 11 Step 2 에서 권한 확인 후, 부족하면 `USER node` 를 제거(root 유지)하거나 docker 그룹 추가로 조정한다.

- [ ] **Step 3: docker-compose.yml 의 cron 서비스 확장**

`docker-compose.yml` 의 `cron:` 서비스 블록(111-121줄)을 아래로 교체:

```yaml
  cron:
    image: ghcr.io/krdn/gons-dashboard-cron:${APP_IMAGE_TAG:-latest}
    container_name: gons-dashboard-cron
    restart: unless-stopped
    depends_on:
      app:
        condition: service_healthy
    environment:
      TZ: Asia/Seoul
      APP_URL: http://app:3020
      CRON_BEARER_TOKEN: ${CRON_BEARER_TOKEN}
      # autopilot 무인 배포 (cron 안에서 app 재배포 — self-kill 회피)
      AUTOPILOT_DEPLOY: ${AUTOPILOT_DEPLOY:-off}
      AUTOPILOT_DOCKER_CONTEXT: default
      AUTOPILOT_COMPOSE_PATH: /home/gon/projects/gon/gons-dashboard/docker-compose.yml
      AUTOPILOT_ENV_PATH: /home/gon/projects/gon/gons-dashboard/.env
      AUTOPILOT_TARGET_FILE: /signal/.autopilot-target
    volumes:
      # autopilot: 호스트 docker daemon 접근 (app 재배포·롤백용)
      - /var/run/docker.sock:/var/run/docker.sock
      # compose/env 파일 접근 (절대경로 — Gotcha #8). ro 로 충분 (--env-file 읽기만).
      - /home/gon/projects/gon/gons-dashboard:/home/gon/projects/gon/gons-dashboard:ro
      # GHA 가 기록한 sha 신호 파일 디렉토리
      - /home/gon/projects/gon/gons-dashboard/.autopilot-signal:/signal
```

- [ ] **Step 4: 문법 검증**

Run: `node --check apps/cron/scheduler.js`
Expected: 출력 없음

- [ ] **Step 5: 커밋**

```bash
git add apps/cron/scheduler.js apps/cron/Dockerfile docker-compose.yml
git commit -m "feat(autopilot): cron 에 deploy-watcher 등록 + docker CLI + socket 마운트"
```

---

### Task 10: autopilot 알림 라우트 + sha 신호 기록 (GHA)

**Files:**
- Create: `apps/dashboard/src/app/api/cron/autopilot-notify/route.ts`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: 기존 cron 라우트의 Bearer·push 패턴 확인**

Run: `cat apps/dashboard/src/app/api/cron/poll-gmail/route.ts`
그리고: `grep -rn "sendPush\|notifyOps\|web-push\|webpush\|sendWebPush" apps/dashboard/src/shared apps/dashboard/src/features --include='*.ts' -l`
Expected: Bearer 검증 방식과 기존 web-push 발송 유틸 위치 파악. 그 패턴을 그대로 따른다.

- [ ] **Step 2: 알림 라우트 작성 (확인한 패턴 반영)**

```typescript
// apps/dashboard/src/app/api/cron/autopilot-notify/route.ts
// autopilot deploy-watcher 가 배포 성공/실패/롤백을 web-push 로 알리는 엔드포인트.
import { NextResponse } from "next/server";
import { env } from "@/shared/config/env";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${env.CRON_BEARER_TOKEN}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { title?: unknown }).title !== "string" ||
    typeof (body as { message?: unknown }).message !== "string"
  ) {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }

  const { title, message } = body as { title: string; message: string };

  // Step 1 에서 확인한 기존 web-push 발송 유틸을 import 해 호출.
  // 예시(실제 함수명은 Step 1 확인값으로 교체):
  //   import { sendOpsPush } from "@/shared/lib/push";
  //   await sendOpsPush({ title, body: message });
  // 발송 유틸이 없으면 OPS_NOTIFY_EMAIL 메일 발송으로 폴백.
  console.warn(`[autopilot-notify] ${title}: ${message}`);

  return NextResponse.json({ status: "sent" });
}
```

> Step 1 에서 발송 유틸을 찾으면 위 주석 블록을 실제 호출로 교체하고 `console.warn` 줄을 제거. 못 찾으면 메일 폴백 구현.

- [ ] **Step 3: 실제 발송 연결 + 게이트 확인**

Step 1 에서 찾은 발송 유틸을 import 해 연결. 그 후:
Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 4: ci.yml docker job 에 sha 신호 기록 step 추가**

`.github/workflows/ci.yml` 의 `docker:` job 마지막 step(`Build & push cron image`) **다음**에 추가:

```yaml
      - name: Record autopilot target sha
        run: |
          echo "Image pushed: sha-${{ github.sha }}"
          echo "AUTOPILOT_TARGET=sha-${{ github.sha }}" >> "$GITHUB_STEP_SUMMARY"
```

> 노트: 이 step 은 추적용 기록이다. 온프렘 deploy-watcher 가 sha 를 읽는 실제 경로(`/signal/.autopilot-target` 파일 갱신)는 Task 11 통합에서 확정한다. 후보 방법: ① 온프렘에 GHA 가 ssh 로 파일 기록(self-hosted runner 또는 deploy key), ② app 빌드 시 `BUILD_SHA` 주입 → `/api/health` 가 노출 → deploy-watcher 가 ghcr `:latest` pull 후 그 컨테이너의 sha 와 비교. Task 11 에서 가장 견고한 경로를 골라 확정·구현한다.

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/app/api/cron/autopilot-notify/route.ts .github/workflows/ci.yml
git commit -m "feat(autopilot): 배포 알림 라우트 + GHA sha 신호 기록"
```

---

## Phase 4: 통합 검증 & 무인 가동

### Task 11: 온프렘 배포·롤백 수동 재현 (무인 가동 전 필수 관문)

**Files:** 없음 (운영 검증) + 필요 시 sha 신호 경로 확정 코드

배포→health→의도적 실패→롤백을 사람이 손으로 재현해 deploy-watcher 로직을 검증한다. 무인 가동의 전제 조건.

- [ ] **Step 1: cron 이미지 재빌드 확인 (docker CLI 포함)**

main 머지 후 GHA 가 `gons-dashboard-cron:latest` 를 재빌드했는지 확인:
Run: `gh run watch`
Expected: Build & Push 성공

- [ ] **Step 2: sha 신호 경로 확정 (Task 10 노트의 미확정 항목)**

운영 환경에서 deploy-watcher 가 최신 sha 를 어떻게 알 수 있는지 가장 견고한 경로를 결정·구현:
- 후보 A: GHA → 온프렘 ssh 로 `/home/gon/projects/gon/gons-dashboard/.autopilot-signal/.autopilot-target` 에 `sha-<gitsha>` 기록
- 후보 B: app `/api/health` 가 `BUILD_SHA` 노출 → deploy-watcher 가 `:latest` pull 후 새 컨테이너 sha 비교
- 결정 후 `getLatestSha()` 가 실제로 값을 반환하는지 확인:
Run (운영): `docker --context home-server exec gons-dashboard-cron cat /signal/.autopilot-target`
Expected: `sha-<gitsha>` 출력

- [ ] **Step 3: cron 컨테이너 docker socket 접근 권한 확인**

Run (운영): `docker --context home-server exec gons-dashboard-cron docker --context default ps`
Expected: 컨테이너 목록. `permission denied /var/run/docker.sock` 면 Task 9 Step 2 의 USER 조정(node→docker 그룹 또는 root) 후 cron 재빌드·재배포.

- [ ] **Step 4: 수동 배포 1회 (정상 경로)**

Run (운영): `docker --context home-server exec gons-dashboard-cron node -e "import('./autopilot/deploy-watcher.js').then(m=>m.runDeployCycle())"`
Expected: 로그에 "배포 불필요" 또는 "배포 성공". health 통과 확인. `curl http://localhost:3020/api/health` → 200.

- [ ] **Step 5: 의도적 실패 → 롤백 재현**

`/signal/.autopilot-target` 에 존재하지 않는 sha(`sha-deadbeef`)를 써서 health 실패 → 롤백 발동 확인:
Expected: health 실패 감지 → 이전 sha 로 롤백 → "배포 실패 → 롤백" 알림. `/api/health` 200 복구. 신호 파일을 정상 sha 로 원복.

- [ ] **Step 6: 검증 결과 기록**

배포·롤백 재현 성공 시 이 Task 완료. 실패 시 deploy-watcher.js / lib.js 수정 후(필요하면 Task 7 테스트 보강) 이 Task 반복.

---

### Task 12: shadow 1회 실행 (클라우드 사이클 엔진 검증)

**Files:**
- Create: `autopilot-log.json`
- Create: `backlog.json`

- [ ] **Step 1: 상태 파일 초기화**

```bash
echo "[]" > autopilot-log.json
echo "[]" > backlog.json
git add autopilot-log.json backlog.json
git commit -m "chore(autopilot): 사이클 이력·백로그 상태 파일 초기화"
```

- [ ] **Step 2: shadow 사이클 1회 실행 (Workflow 도구)**

현재 ISO 주차·시각 확보:
Run: `TZ=Asia/Seoul date +"%G-W%V %Y-%m-%dT%H:%M:%S+09:00"`
그 값으로 Workflow 도구 호출:
```
Workflow({
  scriptPath: "scripts/autopilot/cycle.workflow.js",
  args: { mode: "shadow", isoWeek: "<위 주차>", nowIso: "<위 시각>" }
})
```
Expected: Research→CrossReview→Judge→Implement→PR 진행. shadow 라 PR 만 생성(머지 안 함). 반환 JSON 에 selected/prUrl 포함.

- [ ] **Step 3: 결과 사람 검수**

생성 PR 검토: 후보 선정 합리성, 구현 게이트(typecheck/lint/build 그린), 토론 로그(crossReview/verdicts) 의미성. Workflow 반환값을 `autopilot-log.json` 첫 엔트리로 append.

- [ ] **Step 4: 커밋**

```bash
git add autopilot-log.json
git commit -m "chore(autopilot): shadow 사이클 #1 이력 기록"
```

---

### Task 13: 주간 cron 등록 (/schedule 원격 에이전트)

**Files:** 없음 (스케줄 등록)

- [ ] **Step 1: /schedule 원격 에이전트의 gh·proxy 접근 사전 확인 (비차단이었던 검증)**

/schedule 원격 에이전트 환경에서 확인:
- `gh auth status` — GitHub 머지 권한
- Claude proxy(ANTHROPIC_BASE_URL) 또는 기본 모델 — 에이전트 스폰 가능 여부

불가하면 폴백: GitHub Actions `schedule` cron 으로 Claude Code CLI headless 실행(스펙 §1.1 D5 대안).

- [ ] **Step 2: 주간 cron 등록 (`.autopilot-pause` 체크 포함)**

`/schedule` 스킬로 매주 1회(예: 일요일 09:00 KST) cycle.workflow.js 를 실행하는 원격 에이전트 등록. 프롬프트에 명시:
- 시작 시 레포 루트 `.autopilot-pause` 파일 있으면 즉시 종료(사람 작업 중 일시정지)
- ISO 주차·시각을 발화 시점에 `TZ=Asia/Seoul date` 로 구해 args 에 주입
- 초기엔 `mode: "shadow"` (Task 14 에서 autonomous 승격)

- [ ] **Step 3: cron 1회 발화 e2e 확인**

등록 스케줄을 1회 즉시 트리거해 전체 사이클이 원격 환경에서 도는지 확인.

---

### Task 14: autonomous 승격 (shadow 2주 검수 후)

**Files:** 없음 (모드 전환)

- [ ] **Step 1: shadow 2주 누적 검수**

`autopilot-log.json` 2주치 검토. consensus 품질·구현 안정성·PR 품질이 신뢰할 만한지 판단. 미흡하면 전문가 프롬프트(Task 4) 튜닝 후 shadow 연장.

- [ ] **Step 2: autonomous 전환**

신뢰 확보 시:
- /schedule 사이클 args 를 `mode: "autonomous"` 로 변경 (PR 자동 머지 활성)
- 운영 cron 의 `AUTOPILOT_DEPLOY=on` 설정 + 컨테이너 recreate:
  `docker --context home-server compose -f /home/gon/projects/gon/gons-dashboard/docker-compose.yml --env-file /home/gon/projects/gon/gons-dashboard/.env up -d --no-deps cron`

- [ ] **Step 3: 첫 autonomous 사이클 모니터**

첫 무인 사이클이 PR 머지→GHA 빌드→온프렘 배포→health→(필요시)롤백까지 닫히는지 끝까지 관찰. 문제 시 즉시 `AUTOPILOT_DEPLOY=off` + /schedule `mode: "shadow"` 강등.

---

## Self-Review 결과 (계획 작성자 체크)

**Spec coverage:**
- §2 전문가 패널 5인 → Task 4(프롬프트) + Task 5(스폰). ✅
- §3 토론 3라운드 → Task 5(제안/상호비판/judge). ✅
- §4 구현 페이즈 + 게이트 → Task 6. ✅
- §5.1 protected paths → Task 2 + Task 6(needs-human 분기) + Task 5(touchedPaths 재확정). ✅
- §5.2 무인 배포·롤백 → Task 7~9. ✅
- §5.3 shadow→autonomous 승격 → Task 12, 14. ✅
- §5.4 충돌 규칙(.autopilot-pause, rebase 체크) → Task 6(mergeable 체크) + Task 13 Step 2(.autopilot-pause skip). ✅
- §7 상태 저장(autopilot-log/backlog/last-known-good) → Task 12(log/backlog 초기화), deploy-watcher 의 rolledBackSha + sha 신호로 last-known-good 단순화(Task 8 노트). ✅
- §8 관측·제어 → Task 10(알림), AUTOPILOT_DEPLOY 토글 + mode 토글. ✅

**알려진 미확정(통합에서 확정 — placeholder 아님, 운영 코드 확인 필요):**
1. cron USER 의 docker.sock 권한 → Task 11 Step 3
2. 최신 sha 신호 경로(GHA ssh 파일 기록 vs health BUILD_SHA 노출) → Task 10 Step 4 노트 + Task 11 Step 2 에서 확정·구현
3. web-push 발송 유틸 정확한 함수명 → Task 10 Step 1 에서 grep 확인 후 연결

**Placeholder scan:** Task 10 Step 2 의 발송 유틸 주석은 Step 1 확인 → Step 3 연결로 단계 내 해소. 그 외 없음.

**Type consistency:** `matchesProtectedPath`/`computeScore`/`isDuplicate`/`shouldDeploy`/`buildDeployArgs`/`buildRollbackArgs`/`parseHealthBody`/`runDeployCycle` 시그니처가 정의 Task와 사용 Task에서 일치 확인. ✅
