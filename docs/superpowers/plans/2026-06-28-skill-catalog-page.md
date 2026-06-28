# Claude Code 스킬 카탈로그 페이지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `~/.claude/skills/`의 top-level 스킬을 빌드 시점에 JSON으로 스냅샷해 `/skills` 라우트에서 master-detail(좌측 검색 리스트 + 우측 본문 마크다운)로 보여준다 — 운영(gons.krdn.kr)에서도 동작.

**Architecture:** 빌드 시점 스크립트(`snapshot-skills.ts`)가 SKILL.md들을 gray-matter로 파싱해 (1) 경량 메타데이터를 `entities/skill/catalog.json`에, (2) 각 본문을 `public/skill-catalog/<name>.json`에 기록한다(둘 다 git committed). RSC `/skills/page.tsx`가 메타데이터만 client 위젯에 넘기고, 본문은 스킬 선택 시 `fetch`로 lazy-load한다. `public/`은 Docker 이미지에 포함되므로 런타임 fs 접근 없이 운영에서 동작.

**Tech Stack:** Next.js 16 (App Router, RSC), TypeScript strict, gray-matter(devDependency 신규), react-markdown(기존), Vitest, Tailwind v4, FSD 아키텍처.

## Global Constraints

- **FSD 의존성 방향**: `app → widgets → features → entities → shared` (상위만 하위 참조). entities는 shared만 import. 같은 레이어 직접 import 금지(ESLint `eslint-plugin-boundaries`).
- **entity server/client seam**: `entities/skill/server.ts`(`import "server-only"`) + `entities/skill/client.ts`(server-only import 절대 금지). client tree는 `@/entities/skill/client`로만 import. (CLAUDE.md Gotcha #1/#7)
- **import alias**: 항상 `@/*` (= `apps/dashboard/src/*`). 상대경로 금지.
- **라이트 모드 고정** + 기존 디자인 토큰(`var(--color-text)`, `var(--color-surface)`, `var(--color-hairline)` 등). 하드코딩 색상 지양.
- **locale-free 포맷**: 클라이언트 시각 표시는 locale 의존 금지(hydration mismatch, Gotcha #3). 이 기능엔 시각 표시 없음.
- **테스트**: `tests/**/*.test.ts(x)` 위치, `@/` alias, describe/it/expect AAA 패턴, 순수 함수는 node 환경. **live 카탈로그 개수 단언 금지** — fixture 기반.
- **검증 (PR 전 필수)**: `pnpm typecheck && pnpm lint && cd apps/dashboard && pnpm build` (build가 server/client seam 검출, Gotcha #7).
- **커밋 컨벤션**: `feat:` / `test:` / `chore:` 한국어 제목 (전역 룰). 마침표 생략.

---

### Task 1: 타입 + gray-matter 의존성

**Files:**
- Create: `apps/dashboard/src/entities/skill/model/types.ts`
- Modify: `apps/dashboard/package.json` (devDependencies에 gray-matter 추가)

**Interfaces:**
- Produces: `SkillSource`, `SkillMeta`, `SkillBody` 타입 (이후 모든 Task가 소비)

- [ ] **Step 1: gray-matter (devDep) + remark-gfm (runtime) 설치**

Run:
```bash
cd apps/dashboard && pnpm add -D gray-matter && pnpm add remark-gfm
```
Expected:
- `devDependencies`에 `"gray-matter": "^4.x"` (build-time 파서, 자체 타입 포함).
- `dependencies`에 `"remark-gfm": "^4.x"` (런타임 — react-markdown v10은 CommonMark-only라 SKILL.md의 GFM 테이블(`| 명령어 | 설명 |`)이 raw pipe로 깨짐. SKILL.md는 테이블 천지라 필수. saju 패턴은 LLM 산문이라 gfm 없이 됐지만 여기선 안 됨).

- [ ] **Step 2: 타입 파일 작성**

Create `apps/dashboard/src/entities/skill/model/types.ts`:
```ts
// skill entity — Claude Code 스킬 카탈로그 타입.
// catalog.json(메타) 과 public/skill-catalog/<name>.json(본문) 의 형태를 정의.

export type SkillSource = "standalone" | "personal";

export const SOURCE_LABEL: Record<SkillSource, string> = {
  standalone: "직접 설치",
  personal: "개인 (.agents)",
};

// 리스트(catalog.json)에 담기는 경량 메타데이터 — body 없음.
export interface SkillMeta {
  name: string;
  description: string;
  version: string | null;
  model: string | null;
  source: SkillSource;
  filePath: string; // 원본 SKILL.md 경로 (~/ 축약, 표시용)
  bodyPath: string; // "/skill-catalog/<sanitized-name>.json" (fetch URL)
}

// public/skill-catalog/<name>.json 의 형태.
export interface SkillBody {
  body: string; // SKILL.md frontmatter 이후 마크다운 전문
}
```

- [ ] **Step 3: typecheck 통과 확인**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS (새 파일에 타입 에러 없음)

- [ ] **Step 4: 커밋**

```bash
git add apps/dashboard/src/entities/skill/model/types.ts apps/dashboard/package.json pnpm-lock.yaml
git commit -m "feat: 스킬 카탈로그 타입 + gray-matter·remark-gfm 의존성 추가"
```

---

### Task 2: 순수 파서 로직 (`parseSkill`) — TDD

**Files:**
- Create: `apps/dashboard/src/entities/skill/lib/parseSkill.ts`
- Test: `apps/dashboard/tests/skill-parse.test.ts`

**Interfaces:**
- Consumes: `SkillMeta`, `SkillSource` from `@/entities/skill/model/types`
- Produces:
  - `toMeta(raw: { dirName: string; rawContent: string; isSymlink: boolean; filePath: string }): SkillMeta`
    — gray-matter로 파싱된 SKILL.md 전체 텍스트 + 메타 입력을 받아 `SkillMeta` 반환 (본문 제외).
  - `sanitizeName(name: string): string` — `:` `/` 등을 `-`로 치환해 파일명 안전 문자열 생성.
  - `extractBody(rawContent: string): string` — frontmatter 이후 본문 문자열.

이 함수들은 fs를 직접 만지지 않는다(순수). 스냅샷 스크립트(Task 4)가 fs로 읽어 이 함수에 문자열을 넘긴다 → 테스트 용이.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/dashboard/tests/skill-parse.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { toMeta, sanitizeName, extractBody } from "@/entities/skill/lib/parseSkill";

const NORMAL = `---
name: auto-doc
version: 1.0.0
description: 자동 문서화 스킬. "/doc" 요청 시 사용.
model: sonnet
---

# Auto Documentation Skill

본문 내용.`;

const FOLDED = `---
name: caveman
description: >
  Ultra-compressed communication mode. Cuts token usage ~75% by dropping
  filler, articles, and pleasantries while keeping full technical accuracy.
---

Respond terse.`;

const NO_VERSION_MODEL = `---
name: browse
description: Fast headless browser. (gstack)
triggers:
  - browse a page
allowed-tools:
  - Bash
---

본문.`;

const NO_NAME = `---
description: 이름 없는 스킬.
---

본문.`;

describe("toMeta", () => {
  it("정상 frontmatter → 모든 필드 매핑", () => {
    const m = toMeta({
      dirName: "auto-doc",
      rawContent: NORMAL,
      isSymlink: false,
      filePath: "~/.claude/skills/auto-doc/SKILL.md",
    });
    expect(m.name).toBe("auto-doc");
    expect(m.version).toBe("1.0.0");
    expect(m.model).toBe("sonnet");
    expect(m.description).toContain("자동 문서화");
    expect(m.source).toBe("standalone");
    expect(m.bodyPath).toBe("/skill-catalog/auto-doc.json");
  });

  it("version·model 누락 → null", () => {
    const m = toMeta({
      dirName: "browse",
      rawContent: NO_VERSION_MODEL,
      isSymlink: false,
      filePath: "~/.claude/skills/browse/SKILL.md",
    });
    expect(m.version).toBeNull();
    expect(m.model).toBeNull();
  });

  it("folded scalar(>) description → 한 줄로 접힘 + 한국어/특수문자 보존", () => {
    const m = toMeta({
      dirName: "caveman",
      rawContent: FOLDED,
      isSymlink: true,
      filePath: "~/.agents/skills/caveman/SKILL.md",
    });
    expect(m.description).toContain("Ultra-compressed communication mode");
    expect(m.description).not.toContain("\n");
  });

  it("symlink → source=personal, 실디렉토리 → standalone", () => {
    const sym = toMeta({ dirName: "caveman", rawContent: FOLDED, isSymlink: true, filePath: "x" });
    const dir = toMeta({ dirName: "auto-doc", rawContent: NORMAL, isSymlink: false, filePath: "x" });
    expect(sym.source).toBe("personal");
    expect(dir.source).toBe("standalone");
  });

  it("name 누락 → 디렉토리명 fallback", () => {
    const m = toMeta({ dirName: "mystery", rawContent: NO_NAME, isSymlink: false, filePath: "x" });
    expect(m.name).toBe("mystery");
  });
});

describe("sanitizeName", () => {
  it("콜론·슬래시 → 하이픈", () => {
    expect(sanitizeName("gon:autonomous")).toBe("gon-autonomous");
    expect(sanitizeName("ecc:review")).toBe("ecc-review");
  });
  it("일반 이름은 그대로", () => {
    expect(sanitizeName("auto-doc")).toBe("auto-doc");
  });
});

describe("extractBody", () => {
  it("frontmatter 이후 본문만 반환", () => {
    expect(extractBody(NORMAL).trim()).toBe("# Auto Documentation Skill\n\n본문 내용.");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm --filter @gons/dashboard test skill-parse`
Expected: FAIL — "Cannot find module '@/entities/skill/lib/parseSkill'"

- [ ] **Step 3: 파서 구현**

Create `apps/dashboard/src/entities/skill/lib/parseSkill.ts`:
```ts
import matter from "gray-matter";
import type { SkillMeta, SkillSource } from "../model/types";

/** name 의 파일명 위험 문자(`:` `/` 공백)를 `-` 로 치환. */
export function sanitizeName(name: string): string {
  return name.replace(/[:/\s]+/g, "-");
}

/** frontmatter 이후 본문 문자열. */
export function extractBody(rawContent: string): string {
  return matter(rawContent).content;
}

/** YAML 값을 표시용 문자열로 정규화 (folded scalar 의 줄바꿈 → 공백). */
function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s.length > 0 ? s : null;
}

export interface RawSkill {
  dirName: string;
  rawContent: string;
  isSymlink: boolean;
  filePath: string;
}

export function toMeta(raw: RawSkill): SkillMeta {
  const { data } = matter(raw.rawContent);
  const name = asString(data.name) ?? raw.dirName;
  const source: SkillSource = raw.isSymlink ? "personal" : "standalone";
  return {
    name,
    description: asString(data.description) ?? "",
    version: asString(data.version),
    model: asString(data.model),
    source,
    filePath: raw.filePath,
    bodyPath: `/skill-catalog/${sanitizeName(name)}.json`,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm --filter @gons/dashboard test skill-parse`
Expected: PASS (모든 it 통과)

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/entities/skill/lib/parseSkill.ts apps/dashboard/tests/skill-parse.test.ts
git commit -m "feat: 스킬 frontmatter 파서 toMeta/sanitizeName/extractBody 추가"
```

---

### Task 3: entity seam — server.ts + client.ts + 초기 catalog.json

**Files:**
- Create: `apps/dashboard/src/entities/skill/server.ts`
- Create: `apps/dashboard/src/entities/skill/client.ts`
- Create: `apps/dashboard/src/entities/skill/catalog.json` (초기 빈 배열 placeholder — Task 4 스크립트가 덮어씀)

**Interfaces:**
- Consumes: `SkillMeta` from `./model/types`
- Produces:
  - `getSkills(): SkillMeta[]` (from `@/entities/skill/server`)
  - client barrel: `SkillMeta`, `SkillBody`, `SkillSource`, `SOURCE_LABEL` (from `@/entities/skill/client`)

- [ ] **Step 1: 초기 catalog.json 생성 (빈 배열)**

Create `apps/dashboard/src/entities/skill/catalog.json`:
```json
[]
```
(Task 4 스크립트가 실제 데이터로 덮어씀. 지금은 import 가능하도록 빈 배열만.)

- [ ] **Step 2: server.ts 작성**

Create `apps/dashboard/src/entities/skill/server.ts`:
```ts
// skill entity — server-only entrypoint.
// RSC, scripts 에서 사용. catalog.json 은 빌드 시점에 생성된 committed 메타데이터.
import "server-only";

import catalog from "./catalog.json";
import type { SkillMeta } from "./model/types";

export function getSkills(): SkillMeta[] {
  return catalog as SkillMeta[];
}

export type { SkillMeta, SkillBody, SkillSource } from "./model/types";
```

- [ ] **Step 3: client.ts 작성**

Create `apps/dashboard/src/entities/skill/client.ts`:
```ts
// skill entity — client-safe entrypoint.
// "use client" 트리에서 사용. `"server-only"` import 절대 금지 (Gotcha #1/#7).
// UI 컴포넌트는 widgets/skill-catalog 에 있으므로 여기는 타입·상수만 노출.

export { SOURCE_LABEL } from "./model/types";
export type { SkillMeta, SkillBody, SkillSource } from "./model/types";
```

- [ ] **Step 4: tsconfig resolveJsonModule 확인**

Run: `grep -n resolveJsonModule apps/dashboard/tsconfig.json`
Expected: `"resolveJsonModule": true` 가 있어야 catalog.json import 가능. 없으면 `compilerOptions`에 추가:
```jsonc
"resolveJsonModule": true,
```
(Next.js 16 기본 tsconfig엔 보통 포함되어 있음 — 없을 때만 추가.)

- [ ] **Step 5: typecheck 통과 확인**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add apps/dashboard/src/entities/skill/server.ts apps/dashboard/src/entities/skill/client.ts apps/dashboard/src/entities/skill/catalog.json apps/dashboard/tsconfig.json
git commit -m "feat: 스킬 entity server/client seam + 초기 catalog.json"
```

---

### Task 4: 스냅샷 스크립트 + package.json 배선 + .gitignore 확인

**Files:**
- Create: `apps/dashboard/src/scripts/snapshot-skills.ts`
- Modify: `apps/dashboard/package.json` (scripts에 `skills:snapshot` 추가)
- Modify: `package.json` (root, scripts에 위임 proxy 추가)

**Interfaces:**
- Consumes: `toMeta`, `extractBody`, `sanitizeName` from `@/entities/skill/lib/parseSkill`
- Produces: 실행 시 `entities/skill/catalog.json` + `public/skill-catalog/*.json` 생성

- [ ] **Step 1: 스크립트 작성**

Create `apps/dashboard/src/scripts/snapshot-skills.ts`:
```ts
// ~/.claude/skills/ 의 top-level 스킬을 스캔해 카탈로그를 생성.
// 출력 2개:
//   1) src/entities/skill/catalog.json — 경량 메타데이터 배열 (리스트용)
//   2) public/skill-catalog/<name>.json — 스킬당 본문 1파일 (선택 시 lazy-fetch)
// 실행: `pnpm skills:snapshot` (수동). 스킬이 바뀌면 돌려서 갱신 후 커밋.
//
// tsx --conditions=react-server 로 실행 — entities/skill/lib 가 server-only 가드를
// 건드리지 않지만 다른 스크립트와 일관성 유지. fs 직접 사용(DB 미접근).
import "dotenv/config";

import { readdirSync, readFileSync, writeFileSync, mkdirSync, lstatSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { toMeta, extractBody, sanitizeName } from "@/entities/skill/lib/parseSkill";
import type { SkillMeta } from "@/entities/skill/model/types";

const SKILLS_DIR = join(homedir(), ".claude", "skills");

// 이 스크립트 파일 기준으로 출력 경로 해석 (src/scripts/ → ../entities, ../../public).
const here = fileURLToPath(new URL(".", import.meta.url));
const CATALOG_OUT = join(here, "..", "entities", "skill", "catalog.json");
const BODY_DIR = join(here, "..", "..", "public", "skill-catalog");

function tildePath(abs: string): string {
  const home = homedir();
  return abs.startsWith(home) ? abs.replace(home, "~") : abs;
}

function main() {
  if (!existsSync(SKILLS_DIR)) {
    console.warn(`[snapshot-skills] ${SKILLS_DIR} 없음 — 빈 카탈로그 생성`);
    writeFileSync(CATALOG_OUT, "[]\n");
    return;
  }

  // body 디렉토리 초기화 (제거된 스킬의 stale body 제거).
  if (existsSync(BODY_DIR)) rmSync(BODY_DIR, { recursive: true });
  mkdirSync(BODY_DIR, { recursive: true });

  const entries = readdirSync(SKILLS_DIR, { withFileTypes: true });
  const metas: SkillMeta[] = [];
  const usedFileNames = new Set<string>(); // sanitizeName 충돌 감지
  let skipped = 0;

  for (const entry of entries) {
    const entryPath = join(SKILLS_DIR, entry.name);

    // symlink 여부만 판정 (source 분류용). lstatSync 는 링크를 따라가지 않음.
    // 디렉토리/loose 파일 구분은 SKILL.md 존재 여부로 일원화 — broken symlink 도
    // existsSync 가 false 라 자연히 skip 된다.
    let isSymlink = false;
    try {
      isSymlink = lstatSync(entryPath).isSymbolicLink();
    } catch {
      skipped++;
      continue;
    }

    const skillMd = join(entryPath, "SKILL.md");
    if (!existsSync(skillMd)) {
      // loose 파일(upgrade-domain.md) 또는 SKILL.md 없는 디렉토리(learned, vault-workspace).
      skipped++;
      continue;
    }

    let rawContent: string;
    try {
      rawContent = readFileSync(skillMd, "utf8");
    } catch {
      console.warn(`[snapshot-skills] skip (읽기 실패): ${entry.name}`);
      skipped++;
      continue;
    }

    try {
      const meta = toMeta({
        dirName: entry.name,
        rawContent,
        isSymlink,
        filePath: tildePath(skillMd),
      });
      const fileName = `${sanitizeName(meta.name)}.json`;
      if (usedFileNames.has(fileName)) {
        // 두 스킬이 같은 파일명으로 sanitize → 한쪽 body 가 덮어써져 잘못된 내용 표시.
        console.warn(
          `[snapshot-skills] ⚠️ 파일명 충돌: "${meta.name}" → ${fileName} (이미 존재). skip.`,
        );
        skipped++;
        continue;
      }
      usedFileNames.add(fileName);
      metas.push(meta);
      const body = extractBody(rawContent);
      writeFileSync(join(BODY_DIR, fileName), JSON.stringify({ body }));
    } catch (err) {
      console.warn(`[snapshot-skills] skip (파싱 실패): ${entry.name} — ${String(err)}`);
      skipped++;
    }
  }

  metas.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(CATALOG_OUT, JSON.stringify(metas, null, 2) + "\n");

  console.log(`[snapshot-skills] ✅ 생성 ${metas.length}개 / skip ${skipped}개`);
  console.log(`  catalog: ${tildePath(CATALOG_OUT)}`);
  console.log(`  bodies:  ${tildePath(BODY_DIR)}/`);
}

main();
```

- [ ] **Step 2: apps/dashboard/package.json scripts에 추가**

Modify `apps/dashboard/package.json` — scripts 섹션에 (기존 `tiger:bootstrap` 줄 아래에) 추가:
```jsonc
"skills:snapshot": "tsx --conditions=react-server src/scripts/snapshot-skills.ts",
```

- [ ] **Step 3: root package.json scripts에 위임 추가**

Modify `package.json` (repo root) — scripts 섹션에 (기존 `db:cleanup-projects` 줄 아래에) 추가:
```jsonc
"skills:snapshot": "pnpm --filter @gons/dashboard skills:snapshot",
```

- [ ] **Step 4: 스크립트 실행 — 실제 카탈로그 생성**

Run: `pnpm skills:snapshot`
Expected: `✅ 생성 N개 / skip M개` 로그. `apps/dashboard/src/entities/skill/catalog.json`이 메타데이터 배열로 채워지고, `apps/dashboard/public/skill-catalog/`에 `<name>.json` 파일들 생성됨.

- [ ] **Step 5: 생성물 검증**

Run:
```bash
node -e "const c=require('./apps/dashboard/src/entities/skill/catalog.json'); console.log('entries:', c.length); console.log('sample:', JSON.stringify(c[0]))"
ls apps/dashboard/public/skill-catalog/ | head -5
```
Expected: entries > 0, sample이 SkillMeta 형태(name/description/source/bodyPath 포함), body 파일들 존재.

- [ ] **Step 6: .gitignore가 생성물을 막지 않는지 확인**

Run: `git status --short apps/dashboard/src/entities/skill/catalog.json apps/dashboard/public/skill-catalog/`
Expected: 두 경로 모두 untracked/modified로 보여야 함(gitignore에 안 걸림). `public/`이나 `*.json`을 막는 룰이 있으면 `.gitignore`에 예외(`!apps/dashboard/public/skill-catalog/`) 추가.

- [ ] **Step 7: 커밋 (생성물 포함)**

```bash
git add apps/dashboard/src/scripts/snapshot-skills.ts apps/dashboard/package.json package.json apps/dashboard/src/entities/skill/catalog.json apps/dashboard/public/skill-catalog
git commit -m "feat: 스킬 스냅샷 스크립트 + catalog.json/body 생성물"
```

---

### Task 5: 위젯 필터 순수 함수 (`filterSkills`) — TDD

**Files:**
- Create: `apps/dashboard/src/widgets/skill-catalog/lib/filterSkills.ts`
- Test: `apps/dashboard/tests/skill-filter.test.ts`

**Interfaces:**
- Consumes: `SkillMeta`, `SkillSource` from `@/entities/skill/client`
- Produces:
  - `type SourceFilter = SkillSource | "all"`
  - `filterSkills(skills: SkillMeta[], query: string, source: SourceFilter): SkillMeta[]`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/dashboard/tests/skill-filter.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { filterSkills } from "@/widgets/skill-catalog/lib/filterSkills";
import type { SkillMeta } from "@/entities/skill/client";

function meta(over: Partial<SkillMeta>): SkillMeta {
  return {
    name: "x",
    description: "",
    version: null,
    model: null,
    source: "standalone",
    filePath: "x",
    bodyPath: "/skill-catalog/x.json",
    ...over,
  };
}

const SKILLS: SkillMeta[] = [
  meta({ name: "auto-doc", description: "자동 문서화 스킬", source: "standalone" }),
  meta({ name: "caveman", description: "Ultra-compressed mode", source: "personal" }),
  meta({ name: "browse", description: "Headless BROWSER for QA", source: "standalone" }),
];

describe("filterSkills", () => {
  it("빈 검색어 + all → 전부", () => {
    expect(filterSkills(SKILLS, "", "all")).toHaveLength(3);
  });

  it("name 부분 일치", () => {
    const r = filterSkills(SKILLS, "cave", "all");
    expect(r.map((s) => s.name)).toEqual(["caveman"]);
  });

  it("description 부분 일치 + 대소문자 무시", () => {
    const r = filterSkills(SKILLS, "browser", "all");
    expect(r.map((s) => s.name)).toEqual(["browse"]);
  });

  it("한국어 description 일치", () => {
    const r = filterSkills(SKILLS, "문서화", "all");
    expect(r.map((s) => s.name)).toEqual(["auto-doc"]);
  });

  it("source=personal 필터", () => {
    const r = filterSkills(SKILLS, "", "personal");
    expect(r.map((s) => s.name)).toEqual(["caveman"]);
  });

  it("검색 + source 동시 적용 — 정확한 결과 집합", () => {
    // "auto" 는 auto-doc(standalone) 에만 매치. caveman 은 personal 이라 제외.
    const r = filterSkills(SKILLS, "auto", "standalone");
    expect(r.map((s) => s.name)).toEqual(["auto-doc"]);
  });

  it("source 불일치로 검색어 매치가 걸러진다", () => {
    // "ultra" 는 caveman(personal) description 에만 있음 → standalone 필터로 빈 배열.
    const r = filterSkills(SKILLS, "ultra", "standalone");
    expect(r).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm --filter @gons/dashboard test skill-filter`
Expected: FAIL — "Cannot find module '@/widgets/skill-catalog/lib/filterSkills'"

- [ ] **Step 3: 필터 구현**

Create `apps/dashboard/src/widgets/skill-catalog/lib/filterSkills.ts`:
```ts
import type { SkillMeta, SkillSource } from "@/entities/skill/client";

export type SourceFilter = SkillSource | "all";

export function filterSkills(
  skills: SkillMeta[],
  query: string,
  source: SourceFilter,
): SkillMeta[] {
  const q = query.trim().toLowerCase();
  return skills.filter((s) => {
    if (source !== "all" && s.source !== source) return false;
    if (q === "") return true;
    return (
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
    );
  });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm --filter @gons/dashboard test skill-filter`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/widgets/skill-catalog/lib/filterSkills.ts apps/dashboard/tests/skill-filter.test.ts
git commit -m "feat: 스킬 카탈로그 필터 순수 함수 filterSkills 추가"
```

---

### Task 6: 위젯 UI — SkillDetail (우측 본문, body lazy-fetch)

**Files:**
- Create: `apps/dashboard/src/widgets/skill-catalog/ui/SkillDetail.tsx`

**Interfaces:**
- Consumes: `SkillMeta`, `SkillBody`, `SOURCE_LABEL` from `@/entities/skill/client`; `react-markdown`
- Produces: `<SkillDetail meta={SkillMeta | null} />` — meta가 null이면 empty-state, 아니면 bodyPath fetch 후 마크다운 렌더.

- [ ] **Step 1: SkillDetail 작성**

Create `apps/dashboard/src/widgets/skill-catalog/ui/SkillDetail.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SOURCE_LABEL, type SkillMeta, type SkillBody } from "@/entities/skill/client";

export function SkillDetail({ meta }: { meta: SkillMeta | null }) {
  const [body, setBody] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    if (!meta) {
      setBody(null);
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setBody(null);
    fetch(meta.bodyPath)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<SkillBody>;
      })
      .then((data) => {
        if (cancelled) return;
        setBody(data.body);
        setStatus("idle");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [meta]);

  if (!meta) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-[var(--color-hairline)] p-10 text-sm text-[var(--color-text-muted)]">
        왼쪽에서 스킬을 선택하세요.
      </div>
    );
  }

  return (
    <article className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6">
      <header className="mb-4 border-b border-[var(--color-hairline)] pb-4">
        <h2 className="text-lg font-semibold tracking-tight text-[var(--color-text)]">
          {meta.name}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <span className="inline-flex rounded-md border border-[var(--color-hairline)] px-1.5 py-0.5 font-mono">
            {SOURCE_LABEL[meta.source]}
          </span>
          {meta.version && (
            <span className="font-mono">v{meta.version}</span>
          )}
          {meta.model && (
            <span className="font-mono">model: {meta.model}</span>
          )}
        </div>
        <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
          {meta.filePath}
        </p>
      </header>

      {status === "loading" && (
        <p role="status" className="text-sm text-[var(--color-text-muted)]">
          본문 불러오는 중…
        </p>
      )}
      {status === "error" && (
        <p className="text-sm text-[var(--color-severity-high)]">
          본문을 불러오지 못했습니다. 새로고침으로 재시도하세요.
        </p>
      )}
      {body != null && (
        <div className="text-sm leading-relaxed text-[var(--color-text)] [&_code]:rounded [&_code]:bg-[var(--color-surface-2)] [&_code]:px-1 [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-sm [&_h2]:font-semibold [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p+p]:mt-2 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-[var(--color-surface-2)] [&_pre]:p-3 [&_strong]:font-semibold [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-[var(--color-hairline)] [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-[var(--color-hairline)] [&_th]:bg-[var(--color-surface-2)] [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        </div>
      )}
    </article>
  );
}
```

- [ ] **Step 2: typecheck 통과 확인**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: 커밋**

```bash
git add apps/dashboard/src/widgets/skill-catalog/ui/SkillDetail.tsx
git commit -m "feat: SkillDetail — body lazy-fetch + 마크다운 렌더"
```

---

### Task 7: 위젯 UI — SkillList (좌측 리스트)

**Files:**
- Create: `apps/dashboard/src/widgets/skill-catalog/ui/SkillList.tsx`

**Interfaces:**
- Consumes: `SkillMeta` from `@/entities/skill/client`
- Produces: `<SkillList skills, selectedName, onSelect />` — 항목 클릭 시 `onSelect(name)`.

- [ ] **Step 1: SkillList 작성**

Create `apps/dashboard/src/widgets/skill-catalog/ui/SkillList.tsx`:
```tsx
"use client";
import { SOURCE_LABEL, type SkillMeta } from "@/entities/skill/client";

export function SkillList({
  skills,
  selectedName,
  onSelect,
}: {
  skills: SkillMeta[];
  selectedName: string | null;
  onSelect: (name: string) => void;
}) {
  if (skills.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-[var(--color-hairline)] p-4 text-sm text-[var(--color-text-muted)]">
        조건에 맞는 스킬이 없습니다.
      </p>
    );
  }
  return (
    <ul role="list" className="flex flex-col gap-1">
      {skills.map((s) => {
        const active = s.name === selectedName;
        return (
          <li key={s.name}>
            <button
              type="button"
              onClick={() => onSelect(s.name)}
              aria-current={active ? "true" : undefined}
              className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                active
                  ? "border-[var(--color-accent)] bg-[var(--color-surface-2)]"
                  : "border-transparent hover:border-[var(--color-hairline)] hover:bg-[var(--color-surface-2)]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-[var(--color-text)]">
                  {s.name}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-[var(--color-text-subtle)]">
                  {SOURCE_LABEL[s.source]}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
                {s.description}
              </p>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 2: typecheck 통과 확인**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: 커밋**

```bash
git add apps/dashboard/src/widgets/skill-catalog/ui/SkillList.tsx
git commit -m "feat: SkillList — 좌측 스킬 리스트 항목"
```

---

### Task 8: 위젯 셸 — SkillCatalog (master-detail) + barrel

**Files:**
- Create: `apps/dashboard/src/widgets/skill-catalog/ui/SkillCatalog.tsx`
- Create: `apps/dashboard/src/widgets/skill-catalog/index.ts`

**Interfaces:**
- Consumes: `SkillMeta` from `@/entities/skill/client`; `filterSkills`, `SourceFilter` from `../lib/filterSkills`; `SkillList`, `SkillDetail`
- Produces: `<SkillCatalog skills={SkillMeta[]} />` (from `@/widgets/skill-catalog`)

- [ ] **Step 1: SkillCatalog 작성**

Create `apps/dashboard/src/widgets/skill-catalog/ui/SkillCatalog.tsx`:
```tsx
"use client";
import { useMemo, useState } from "react";
import type { SkillMeta } from "@/entities/skill/client";
import { filterSkills, type SourceFilter } from "../lib/filterSkills";
import { SkillList } from "./SkillList";
import { SkillDetail } from "./SkillDetail";

const SOURCE_CHIPS: { value: SourceFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "standalone", label: "직접 설치" },
  { value: "personal", label: "개인" },
];

export function SkillCatalog({ skills }: { skills: SkillMeta[] }) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const filtered = useMemo(
    () => filterSkills(skills, query, source),
    [skills, query, source],
  );

  const selectedMeta = useMemo(
    () => skills.find((s) => s.name === selectedName) ?? null,
    [skills, selectedName],
  );

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <aside className="flex flex-col gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="스킬 이름·설명 검색"
          aria-label="스킬 검색"
          className="w-full rounded-lg border border-[var(--color-hairline)] bg-white px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus-visible:border-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
        />
        <div role="group" aria-label="출처 필터" className="flex items-center gap-1 text-xs">
          {SOURCE_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => setSource(chip.value)}
              aria-pressed={source === chip.value}
              className={`rounded-md border px-2 py-1 transition-colors ${
                source === chip.value
                  ? "border-[var(--color-accent)] bg-[var(--color-surface-2)] text-[var(--color-text)]"
                  : "border-[var(--color-hairline)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
              }`}
            >
              {chip.label}
            </button>
          ))}
          <span className="ml-auto font-mono text-[var(--color-text-subtle)]">
            {filtered.length}
          </span>
        </div>
        <SkillList skills={filtered} selectedName={selectedName} onSelect={setSelectedName} />
      </aside>
      <SkillDetail meta={selectedMeta} />
    </div>
  );
}
```

- [ ] **Step 2: barrel 작성**

Create `apps/dashboard/src/widgets/skill-catalog/index.ts`:
```ts
// Public API for widgets/skill-catalog
export { SkillCatalog } from "./ui/SkillCatalog";
```

- [ ] **Step 3: typecheck 통과 확인**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add apps/dashboard/src/widgets/skill-catalog/ui/SkillCatalog.tsx apps/dashboard/src/widgets/skill-catalog/index.ts
git commit -m "feat: SkillCatalog master-detail 셸 + 위젯 barrel"
```

---

### Task 9: /skills 라우트 페이지 + 메인 진입 링크

**Files:**
- Create: `apps/dashboard/src/app/skills/page.tsx`
- Modify: `apps/dashboard/src/app/page.tsx` (좌측 콘텐츠의 /stocks 링크 아래에 /skills 링크 추가)

**Interfaces:**
- Consumes: `getSkills` from `@/entities/skill/server`; `SkillCatalog` from `@/widgets/skill-catalog`; `auth` (NextAuth)

- [ ] **Step 1: /skills/page.tsx 작성**

먼저 기존 페이지의 auth import 경로 확인:
Run: `grep -n "import.*auth" apps/dashboard/src/app/stocks/page.tsx`
Expected: `import { auth } from "..."` 경로 확인 (보통 `@/features/auth` 또는 `@/shared/lib/auth`). 그 경로를 아래 `<AUTH_IMPORT>`에 사용.

Create `apps/dashboard/src/app/skills/page.tsx`:
```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "<AUTH_IMPORT>"; // stocks/page.tsx와 동일 경로
import { getSkills } from "@/entities/skill/server";
import { SkillCatalog } from "@/widgets/skill-catalog";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const skills = getSkills();

  return (
    <main className="mx-auto w-full max-w-[1240px] px-6 py-12">
      <header className="mb-8">
        <Link
          href="/"
          className="text-xs text-[var(--color-text-subtle)] hover:underline"
        >
          ← 대시보드로
        </Link>
        <h1 className="mt-2 text-display font-bold tracking-tight">
          Claude Code 스킬
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          설치된 스킬의 사용법과 출처를 살펴봅니다 ({skills.length}개).
        </p>
      </header>
      <SkillCatalog skills={skills} />
    </main>
  );
}
```

- [ ] **Step 2: 메인 page.tsx에 진입 링크 추가**

Modify `apps/dashboard/src/app/page.tsx` — `/stocks` 링크 `</Link>` 직후에 같은 스타일로 추가:
```tsx
          <Link
            href="/skills"
            className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] px-5 py-4 transition-colors hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-2)]"
          >
            <h3 className="text-sm font-semibold">Claude Code 스킬</h3>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              설치된 스킬의 사용법·출처 카탈로그 →
            </p>
          </Link>
```
(정확한 삽입 위치는 `grep -n 'href="/stocks"' apps/dashboard/src/app/page.tsx`로 찾아 그 `</Link>` 다음 줄.)

- [ ] **Step 3: typecheck + lint 통과 확인**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: PASS (FSD boundary 위반 없음 — app이 widgets·entities/server import은 허용)

- [ ] **Step 4: 커밋**

```bash
git add apps/dashboard/src/app/skills/page.tsx apps/dashboard/src/app/page.tsx
git commit -m "feat: /skills 라우트 페이지 + 메인 대시보드 진입 링크"
```

---

### Task 10: 전체 검증 + 수동 dogfood

**Files:** (없음 — 검증만)

- [ ] **Step 0: Dockerfile이 public/을 복사하는지 확인 (prod 404 방지 — 필수)**

next.config가 `output: "standalone"`이면 `.next/standalone`에 `public/`이 자동 포함되지 **않으므로** Dockerfile이 명시 COPY해야 한다. 안 하면 운영에서 `fetch("/skill-catalog/<name>.json")`이 404 — build-time snapshot 결정의 목적을 정면으로 깨뜨림.

Run:
```bash
grep -n "public" apps/dashboard/Dockerfile
```
Expected: `COPY --from=builder ... /app/apps/dashboard/public ./apps/dashboard/public` 류 줄이 **있어야** 함 (실측 확인됨 — line 91). 새 `public/skill-catalog/`는 이 COPY에 자동 포함되므로 추가 수정 불필요. 만약 이 줄이 없다면(향후 Dockerfile 변경 시) 그 줄을 추가하는 것이 이 step의 fix.

- [ ] **Step 1: 전체 테스트**

Run: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm --filter @gons/dashboard test`
Expected: skill-parse, skill-filter 테스트 PASS. (DB 통합 테스트는 로컬 DB 없으면 ECONNREFUSED — 기존 동작, 무방.)

- [ ] **Step 2: 빌드 (server/client seam 검출 — 필수)**

Run: `cd apps/dashboard && pnpm build`
Expected: PASS. `Module not found: Can't resolve 'tls'/'fs'` 류 에러 없음 (client tree가 server-only를 끌어오지 않음 확인). `/skills` 라우트가 빌드 산출물에 포함됨.

- [ ] **Step 3: dev 서버 수동 확인**

Run: `pnpm dev` 후 브라우저에서 `http://localhost:3020/skills` 접속.
검증 항목:
- 좌측 리스트에 스킬들 표시 (검색·필터 동작)
- 스킬 클릭 → 우측에 본문 마크다운 렌더 (네트워크 탭에서 `/skill-catalog/<name>.json` fetch 확인)
- **`auto-doc` 선택 → 테이블이 실제 표(`<table>`)로 렌더되는지 확인** (gfm 동작 검증 — pipe soup `| 명령어 | 설명 |` 로 보이면 remark-gfm 누락). `deploy-manager`/`framework-manager`도 테이블 보유.
- 메인 `http://localhost:3020/`에서 "Claude Code 스킬" 카드 클릭 → /skills 이동

> **주의 (Gotcha — dogfood):** dev 서버는 운영 DB(192.168.0.5)를 볼 수 있음. /skills는 읽기 전용(DB 미접근)이라 안전하지만, 자동 클릭 스크립트로 다른 위젯의 비가역 액션을 건드리지 말 것. /skills 검증만 수동으로.

- [ ] **Step 4: 최종 정리 커밋 (필요 시)**

빌드 중 생긴 미반영 변경이 있으면 커밋. 없으면 skip.
```bash
git status --short
```

---

## Self-Review

**1. Spec coverage:**
- 데이터 아키텍처(build-time snapshot, metadata/body 분리, public/ lazy-fetch) → Task 1·3·4·6 ✓
- 스냅샷 스크립트(gray-matter, source 분류, skip+로깅) → Task 2·4 ✓
- FSD entity seam(server.ts+client.ts) → Task 3 ✓
- widget(master-detail, 검색·필터) → Task 5·6·7·8 ✓
- /skills 라우트 + 진입 링크 → Task 9 ✓
- UI(react-markdown, 토큰, 라이트모드, empty/loading/error) → Task 6·7·8 ✓
- 테스트(fixture 기반 parseSkill·filterSkills, live count 미단언) → Task 2·5 ✓
- 검증(typecheck/lint/build/dogfood) → Task 10 ✓
- YAGNI 범위 밖 항목(plugin enum, 자동 동기화, 공유 nav, 신택스 하이라이팅) → 미구현 ✓

**2. Placeholder scan:** `<AUTH_IMPORT>`는 Task 9 Step 1에서 grep으로 확정하도록 명시한 의도적 플레이스홀더(기존 페이지마다 경로가 다를 수 있어 실측 지시). 그 외 TBD/TODO 없음. ✓

**3. Type consistency:**
- `SkillMeta`/`SkillBody`/`SkillSource` (Task 1) → server.ts/client.ts(Task 3)/parseSkill(Task 2)/filterSkills(Task 5)/UI(Task 6·7·8)에서 일관 사용 ✓
- `toMeta`/`extractBody`/`sanitizeName` (Task 2) → snapshot-skills(Task 4)에서 동일 시그니처 호출 ✓
- `filterSkills(skills, query, source)` / `SourceFilter` (Task 5) → SkillCatalog(Task 8)에서 동일 호출 ✓
- `getSkills(): SkillMeta[]` (Task 3) → page.tsx(Task 9)에서 동일 ✓
- `bodyPath = "/skill-catalog/<sanitized>.json"` (Task 2) ↔ snapshot 출력 파일명(Task 4) ↔ SkillDetail fetch(Task 6) 정합 ✓
