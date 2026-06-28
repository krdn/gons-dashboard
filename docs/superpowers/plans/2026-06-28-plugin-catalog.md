# Plugin 카탈로그 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/plugins` 페이지를 추가해 설치된 Claude Code plugin 43개를 marketplace 그룹 + 구성요소 드릴다운 + active/dormant 배지로 발견·인벤토리한다.

**Architecture:** skill 카탈로그(`/skills`)의 검증된 패턴을 **병렬 복제**한다 — build-time snapshot 스크립트가 `installed_plugins.json` + `settings.json enabledPlugins` + 각 installPath를 머지해 committed `plugin-catalog.json`을 만들고, 마스터-디테일 셸이 이를 렌더한다. plugin은 컨테이너이므로 Detail이 내부 구성요소(skills/agents/commands/hooks/MCP)로 드릴다운된다. 공유 추상화는 만들지 않는다 (YAGNI).

**Tech Stack:** Next.js 16 RSC, TypeScript strict, vitest+jsdom, FSD(entities/plugin + widgets/plugin-catalog), tsx 스냅샷 스크립트.

## Global Constraints

- 운영 Docker는 `~/.claude`를 못 읽음 — 모든 데이터는 build-time `plugin-catalog.json`에 박는다. 런타임 fs 접근 0.
- FSD 의존성 방향: `app → widgets → entities → shared`. entities barrel은 `server.ts`(server-only) + `client.ts`(타입·상수) 분리.
- `"use client"` 컴포넌트는 `@/entities/plugin/client`만 import (server-only 누출 금지 — Gotcha #1/#7).
- 검증: `cd apps/dashboard && pnpm typecheck && pnpm lint && pnpm build` (build는 server/client seam 게이트 — typecheck/lint로 안 잡힘).
- vitest 실행: `cd apps/dashboard && pnpm exec vitest run` (모노레포 root에서 직접 실행 불가).
- 생성물(`plugin-catalog.json`)은 커밋(tracked) — skill catalog.json과 동일. 본문 마크다운 없이 메타+이름목록뿐이라 작음.
- 색상은 `globals.css` 시맨틱 토큰만 (`--color-accent`, `--color-ok`, `--color-text-muted` 등). 하드코딩 금지.

---

### Task 1: 데이터 모델 + parsePlugin 순수 함수

**Files:**
- Create: `apps/dashboard/src/entities/plugin/model/types.ts`
- Create: `apps/dashboard/src/entities/plugin/lib/parsePlugin.ts`
- Test: `apps/dashboard/tests/plugin-parse.test.ts`

**Interfaces:**
- Produces: `PluginMeta`, `PluginComponentCounts`, `PluginComponents`, `PluginCatalog`, `PluginStatus` 타입. `countComponents(installPath: string): { counts: PluginComponentCounts; components: PluginComponents }`, `parseManifest(installPath: string): { description: string; author: string; homepage: string; keywords: string[] }`, `STATUS_LABEL: Record<PluginStatus, string>`.

`countComponents`/`parseManifest`는 fs를 받지 않고 **경로 문자열**만 받아 내부에서 `node:fs`를 쓴다 (스냅샷 스크립트 전용 — server tree). 테스트는 실제 임시 디렉토리 fixture로 검증.

- [ ] **Step 1: 타입 정의 작성**

`apps/dashboard/src/entities/plugin/model/types.ts`:

```ts
export type PluginStatus = "active" | "dormant" | "missing";

export const STATUS_LABEL: Record<PluginStatus, string> = {
  active: "활성",
  dormant: "휴면",
  missing: "경로 없음",
};

export interface PluginComponentCounts {
  skills: number;
  agents: number;
  commands: number;
  hooks: boolean;
  mcp: boolean;
}

export interface PluginComponents {
  skills: string[];
  agents: string[];
  commands: string[];
}

export interface PluginMeta {
  id: string; // "superpowers@claude-plugins-official"
  name: string; // "superpowers"
  marketplace: string; // "claude-plugins-official"
  version: string;
  description: string;
  author: string;
  homepage: string;
  keywords: string[];
  enabled: boolean;
  resolved: boolean;
  counts: PluginComponentCounts;
  components: PluginComponents;
}

export interface PluginMarketplaceMeta {
  label: string;
  count: number;
}

export interface PluginCatalog {
  plugins: PluginMeta[];
  marketplaces: Record<string, PluginMarketplaceMeta>;
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`apps/dashboard/tests/plugin-parse.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countComponents, parseManifest } from "@/entities/plugin/lib/parsePlugin";

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "plugin-parse-"));
  // skills/ 2개, agents/ 1개, commands/ 0개, hooks.json 있음, .mcp.json 없음
  mkdirSync(join(root, "skills", "alpha"), { recursive: true });
  mkdirSync(join(root, "skills", "beta"), { recursive: true });
  mkdirSync(join(root, "agents"), { recursive: true });
  writeFileSync(join(root, "agents", "rev.md"), "# rev");
  mkdirSync(join(root, "hooks"), { recursive: true });
  writeFileSync(join(root, "hooks", "hooks.json"), "{}");
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({
      description: "Test plugin",
      author: { name: "Jane" },
      homepage: "https://example.com",
      keywords: ["a", "b"],
    }),
  );
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("countComponents", () => {
  it("디렉토리/파일/존재 플래그를 정확히 센다", () => {
    const { counts, components } = countComponents(root);
    expect(counts.skills).toBe(2);
    expect(counts.agents).toBe(1);
    expect(counts.commands).toBe(0);
    expect(counts.hooks).toBe(true);
    expect(counts.mcp).toBe(false);
    expect(components.skills.sort()).toEqual(["alpha", "beta"]);
    expect(components.agents).toEqual(["rev"]);
  });

  it("존재하지 않는 경로는 0/false/빈배열", () => {
    const { counts, components } = countComponents(join(root, "nope"));
    expect(counts.skills).toBe(0);
    expect(counts.hooks).toBe(false);
    expect(components.skills).toEqual([]);
  });
});

describe("parseManifest", () => {
  it("author 객체 .name 추출 + keywords 보존", () => {
    const m = parseManifest(root);
    expect(m.description).toBe("Test plugin");
    expect(m.author).toBe("Jane");
    expect(m.homepage).toBe("https://example.com");
    expect(m.keywords).toEqual(["a", "b"]);
  });

  it("manifest 없으면 빈 기본값", () => {
    const m = parseManifest(join(root, "nope"));
    expect(m.description).toBe("");
    expect(m.author).toBe("");
    expect(m.keywords).toEqual([]);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd apps/dashboard && pnpm exec vitest run tests/plugin-parse.test.ts`
Expected: FAIL — "countComponents is not a function" (parsePlugin 미존재)

- [ ] **Step 4: parsePlugin 구현**

`apps/dashboard/src/entities/plugin/lib/parsePlugin.ts`:

```ts
// plugin installPath 하위를 스캔해 구성요소 카운트 + manifest 메타 추출.
// fs 직접 사용 — 스냅샷 스크립트(server tree) 전용. 경로 문자열만 받는다.
import { readdirSync, existsSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginComponentCounts, PluginComponents } from "../model/types";

function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function listMdNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name.replace(/\.md$/, ""));
  } catch {
    return [];
  }
}

function hasHooks(installPath: string): boolean {
  const hooksDir = join(installPath, "hooks");
  if (existsSync(join(hooksDir, "hooks.json"))) return true;
  try {
    return existsSync(hooksDir) && statSync(hooksDir).isDirectory();
  } catch {
    return false;
  }
}

export function countComponents(installPath: string): {
  counts: PluginComponentCounts;
  components: PluginComponents;
} {
  const skills = listDirs(join(installPath, "skills")).sort();
  const agents = listMdNames(join(installPath, "agents")).sort();
  const commands = listMdNames(join(installPath, "commands")).sort();
  const hooks = hasHooks(installPath);
  const mcp = existsSync(join(installPath, ".mcp.json"));
  return {
    counts: { skills: skills.length, agents: agents.length, commands: commands.length, hooks, mcp },
    components: { skills, agents, commands },
  };
}

export function parseManifest(installPath: string): {
  description: string;
  author: string;
  homepage: string;
  keywords: string[];
} {
  const empty = { description: "", author: "", homepage: "", keywords: [] as string[] };
  const manifestPath = join(installPath, ".claude-plugin", "plugin.json");
  if (!existsSync(manifestPath)) return empty;
  try {
    const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    const author =
      typeof raw.author === "string"
        ? raw.author
        : typeof raw.author?.name === "string"
          ? raw.author.name
          : "";
    return {
      description: typeof raw.description === "string" ? raw.description : "",
      author,
      homepage: typeof raw.homepage === "string" ? raw.homepage : "",
      keywords: Array.isArray(raw.keywords) ? raw.keywords.filter((k: unknown) => typeof k === "string") : [],
    };
  } catch {
    return empty;
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd apps/dashboard && pnpm exec vitest run tests/plugin-parse.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/entities/plugin/model/types.ts apps/dashboard/src/entities/plugin/lib/parsePlugin.ts apps/dashboard/tests/plugin-parse.test.ts
git commit -m "feat: plugin 카탈로그 데이터 모델 + parsePlugin 카운트 함수"
```

---

### Task 2: 스냅샷 스크립트 + i18n overlay + catalog.json 생성

**Files:**
- Create: `apps/dashboard/src/scripts/snapshot-plugins.ts`
- Create: `apps/dashboard/src/entities/plugin/translations.ko.json`
- Create: `apps/dashboard/src/entities/plugin/plugin-catalog.json` (스크립트 실행 산출물)
- Modify: `apps/dashboard/package.json` (scripts에 `plugins:snapshot` 추가)

**Interfaces:**
- Consumes: Task 1의 `countComponents`, `parseManifest`, `PluginMeta`, `PluginCatalog`, `PluginMarketplaceMeta`.
- Produces: `plugin-catalog.json` = `{ plugins: PluginMeta[], marketplaces: Record<slug,{label,count}> }`.

이 Task는 fs를 읽어 외부 환경(`~/.claude`)에 의존하므로 단위 테스트 대신 **스크립트 실행 + 출력 검증**으로 게이트한다 (snapshot-skills.ts와 동일 — TDD 예외, 환경 의존 스크립트).

- [ ] **Step 1: 빈 translations overlay 생성**

`apps/dashboard/src/entities/plugin/translations.ko.json`:

```json
{}
```

- [ ] **Step 2: 스냅샷 스크립트 작성**

`apps/dashboard/src/scripts/snapshot-plugins.ts`:

```ts
// ~/.claude/plugins/installed_plugins.json + settings.json enabledPlugins 를 머지해
// plugin 카탈로그를 생성. 각 plugin installPath 하위를 스캔해 구성요소 카운트.
// 출력: src/entities/plugin/plugin-catalog.json (커밋). 본문 없음 — 메타+이름목록만.
// 실행: `pnpm plugins:snapshot` (수동). plugin 이 바뀌면 돌려서 갱신 후 커밋.
import "dotenv/config";

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { countComponents, parseManifest } from "@/entities/plugin/lib/parsePlugin";
import type { PluginMeta, PluginMarketplaceMeta } from "@/entities/plugin/model/types";

const PLUGINS_JSON = join(homedir(), ".claude", "plugins", "installed_plugins.json");
const SETTINGS_JSON = join(homedir(), ".claude", "settings.json");

const here = fileURLToPath(new URL(".", import.meta.url));
const CATALOG_OUT = join(here, "..", "entities", "plugin", "plugin-catalog.json");
const TRANSLATIONS_PATH = join(here, "..", "entities", "plugin", "translations.ko.json");

type TranslationEntry = { description?: string };
type Translations = Record<string, TranslationEntry>;

function loadJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (err) {
    console.warn(`[snapshot-plugins] ⚠️ ${path} 파싱 실패 — fallback: ${String(err)}`);
    return fallback;
  }
}

function main() {
  if (!existsSync(PLUGINS_JSON)) {
    console.warn(`[snapshot-plugins] ${PLUGINS_JSON} 없음 — 빈 카탈로그 생성`);
    mkdirSync(dirname(CATALOG_OUT), { recursive: true });
    writeFileSync(CATALOG_OUT, JSON.stringify({ plugins: [], marketplaces: {} }, null, 2) + "\n");
    return;
  }

  const installed = loadJson<{ plugins: Record<string, Array<{ installPath: string; version: string }>> }>(
    PLUGINS_JSON,
    { plugins: {} },
  );
  const settings = loadJson<{ enabledPlugins?: Record<string, boolean> }>(SETTINGS_JSON, {});
  const enabledMap = settings.enabledPlugins ?? {};
  const translations = loadJson<Translations>(TRANSLATIONS_PATH, {});

  const metas: PluginMeta[] = [];
  let unresolved = 0;
  let translatedCount = 0;

  for (const [id, installs] of Object.entries(installed.plugins)) {
    const inst = installs[0];
    if (!inst) continue;
    const atIdx = id.lastIndexOf("@");
    const name = atIdx > 0 ? id.slice(0, atIdx) : id;
    const marketplace = atIdx > 0 ? id.slice(atIdx + 1) : "unknown";
    const installPath = inst.installPath;
    const resolved = existsSync(installPath);
    if (!resolved) unresolved++;

    const { counts, components } = resolved
      ? countComponents(installPath)
      : { counts: { skills: 0, agents: 0, commands: 0, hooks: false, mcp: false }, components: { skills: [], agents: [], commands: [] } };
    const manifest = resolved
      ? parseManifest(installPath)
      : { description: "", author: "", homepage: "", keywords: [] as string[] };

    const tr = translations[name];
    let description = manifest.description;
    if (tr?.description) {
      description = tr.description;
      translatedCount++;
    }

    metas.push({
      id,
      name,
      marketplace,
      version: inst.version ?? "",
      description,
      author: manifest.author,
      homepage: manifest.homepage,
      keywords: manifest.keywords,
      enabled: enabledMap[id] === true,
      resolved,
      counts,
      components,
    });
  }

  metas.sort((a, b) => a.name.localeCompare(b.name));

  // marketplace 메타 — slug → {label, count}. label 은 slug 그대로(UI 가독용).
  const marketplaces: Record<string, PluginMarketplaceMeta> = {};
  for (const m of metas) {
    const mk = marketplaces[m.marketplace];
    if (mk) mk.count++;
    else marketplaces[m.marketplace] = { label: m.marketplace, count: 1 };
  }

  mkdirSync(dirname(CATALOG_OUT), { recursive: true });
  writeFileSync(CATALOG_OUT, JSON.stringify({ plugins: metas, marketplaces }, null, 2) + "\n");

  const active = metas.filter((m) => m.enabled).length;
  console.log(
    `[snapshot-plugins] ✅ 생성 ${metas.length}개 / 활성 ${active} / 휴면 ${metas.length - active} / 경로없음 ${unresolved} / 한글 overlay ${translatedCount}`,
  );
  console.log(`  catalog: ${CATALOG_OUT}`);
  const mkLine = Object.entries(marketplaces)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([slug, m]) => `${slug}=${m.count}`)
    .join(" ");
  console.log(`  marketplace 분포: ${mkLine}`);
}

main();
```

- [ ] **Step 3: package.json에 스크립트 추가**

`apps/dashboard/package.json` scripts 객체에 (`skills:snapshot` 줄 아래):

```json
"plugins:snapshot": "tsx --conditions=react-server src/scripts/snapshot-plugins.ts",
```

- [ ] **Step 4: 스냅샷 실행 + 출력 검증**

Run: `cd apps/dashboard && pnpm plugins:snapshot`
Expected: `✅ 생성 43개` 근처 (실제 설치 수), 활성/휴면 분리, marketplace 분포 출력. `plugin-catalog.json` 생성됨.

검증: catalog.json에 `superpowers`가 `counts.skills > 0`, `context7`가 `counts.mcp: true`, `enabled` 값이 settings와 일치하는지 눈으로 확인.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/scripts/snapshot-plugins.ts apps/dashboard/src/entities/plugin/translations.ko.json apps/dashboard/src/entities/plugin/plugin-catalog.json apps/dashboard/package.json
git commit -m "feat: plugin 스냅샷 스크립트 + catalog.json 생성"
```

---

### Task 3: entity barrel (server/client) + getPlugins

**Files:**
- Create: `apps/dashboard/src/entities/plugin/server.ts`
- Create: `apps/dashboard/src/entities/plugin/client.ts`
- Test: `apps/dashboard/tests/plugin-server.test.ts`

**Interfaces:**
- Consumes: Task 2의 `plugin-catalog.json`, Task 1의 타입.
- Produces: `getPlugins(): PluginMeta[]`, `getPluginMarketplaces(): Record<string, PluginMarketplaceMeta>` (server.ts). `client.ts`는 타입 + `STATUS_LABEL` re-export.

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/dashboard/tests/plugin-server.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getPlugins, getPluginMarketplaces } from "@/entities/plugin/server";

describe("getPlugins", () => {
  it("catalog.json 을 배열로 반환한다", () => {
    const plugins = getPlugins();
    expect(Array.isArray(plugins)).toBe(true);
    expect(plugins.length).toBeGreaterThan(0);
  });

  it("각 plugin 이 필수 필드를 갖는다", () => {
    for (const p of getPlugins()) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.name).toBe("string");
      expect(typeof p.enabled).toBe("boolean");
      expect(typeof p.counts.skills).toBe("number");
    }
  });

  it("marketplaces 메타의 count 합이 plugin 수와 같다", () => {
    const total = Object.values(getPluginMarketplaces()).reduce((s, m) => s + m.count, 0);
    expect(total).toBe(getPlugins().length);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/dashboard && pnpm exec vitest run tests/plugin-server.test.ts`
Expected: FAIL — `@/entities/plugin/server` 미존재

- [ ] **Step 3: server.ts 작성**

`apps/dashboard/src/entities/plugin/server.ts`:

```ts
// plugin entity — server-only entrypoint.
// RSC, scripts 에서 사용. plugin-catalog.json 은 빌드 시점 committed 메타데이터.
import "server-only";

import catalog from "./plugin-catalog.json";
import type { PluginCatalog, PluginMeta, PluginMarketplaceMeta } from "./model/types";

const data = catalog as PluginCatalog;

export function getPlugins(): PluginMeta[] {
  return data.plugins;
}

export function getPluginMarketplaces(): Record<string, PluginMarketplaceMeta> {
  return data.marketplaces;
}

export type { PluginMeta, PluginMarketplaceMeta, PluginStatus } from "./model/types";
```

- [ ] **Step 4: client.ts 작성**

`apps/dashboard/src/entities/plugin/client.ts`:

```ts
// plugin entity — client-safe entrypoint.
// "use client" 트리에서 사용. `"server-only"` import 절대 금지 (Gotcha #1/#7).
// UI 컴포넌트는 widgets/plugin-catalog 에 있으므로 여기는 타입·상수만 노출.

export { STATUS_LABEL } from "./model/types";
export type {
  PluginMeta,
  PluginStatus,
  PluginComponentCounts,
  PluginComponents,
  PluginMarketplaceMeta,
} from "./model/types";
```

> **참고**: server.ts의 테스트는 `"server-only"` import 때문에 vitest에서 throw할 수 있다. skill의 server.ts 테스트가 통과한다면 vitest config가 `server-only`를 stub 처리한 것 — 그대로 따라간다. 만약 throw하면 테스트를 `getPlugins`를 catalog.json 직접 import로 검증하도록 조정(스킬 테스트 선례 확인 후).

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd apps/dashboard && pnpm exec vitest run tests/plugin-server.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/entities/plugin/server.ts apps/dashboard/src/entities/plugin/client.ts apps/dashboard/tests/plugin-server.test.ts
git commit -m "feat: plugin entity server/client barrel + getPlugins"
```

---

### Task 4: filterPlugins + groupPlugins 순수 함수

**Files:**
- Create: `apps/dashboard/src/widgets/plugin-catalog/lib/filterPlugins.ts`
- Create: `apps/dashboard/src/widgets/plugin-catalog/lib/groupPlugins.ts`
- Test: `apps/dashboard/tests/plugin-filter.test.ts`
- Test: `apps/dashboard/tests/plugin-group.test.ts`

**Interfaces:**
- Consumes: Task 1의 `PluginMeta`, `PluginStatus`, `PluginMarketplaceMeta`.
- Produces: `filterPlugins(plugins, query, marketplace: MarketplaceFilter, status: StatusFilter): PluginMeta[]`, `MarketplaceFilter = string | "all"`, `StatusFilter = PluginStatus | "all"`. `groupPlugins(filtered, marketplaces): PluginGroup[]`, `PluginGroup = { slug, label, count, plugins }`. `pluginStatus(p: PluginMeta): PluginStatus`.

- [ ] **Step 1: filter 실패 테스트 작성**

`apps/dashboard/tests/plugin-filter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { filterPlugins, pluginStatus } from "@/widgets/plugin-catalog/lib/filterPlugins";
import type { PluginMeta } from "@/entities/plugin/client";

function mk(over: Partial<PluginMeta>): PluginMeta {
  return {
    id: "x@mk", name: "x", marketplace: "mk", version: "1", description: "",
    author: "", homepage: "", keywords: [], enabled: true, resolved: true,
    counts: { skills: 0, agents: 0, commands: 0, hooks: false, mcp: false },
    components: { skills: [], agents: [], commands: [] },
    ...over,
  };
}

const plugins: PluginMeta[] = [
  mk({ id: "a@one", name: "alpha", marketplace: "one", enabled: true, resolved: true, description: "first tool" }),
  mk({ id: "b@two", name: "beta", marketplace: "two", enabled: false, resolved: true }),
  mk({ id: "c@one", name: "gamma", marketplace: "one", enabled: true, resolved: false }),
];

describe("pluginStatus", () => {
  it("resolved=false → missing (enabled 무관)", () => {
    expect(pluginStatus(plugins[2])).toBe("missing");
  });
  it("enabled=true & resolved → active", () => {
    expect(pluginStatus(plugins[0])).toBe("active");
  });
  it("enabled=false & resolved → dormant", () => {
    expect(pluginStatus(plugins[1])).toBe("dormant");
  });
});

describe("filterPlugins 직교성", () => {
  it("marketplace 필터", () => {
    const r = filterPlugins(plugins, "", "one", "all");
    expect(r.map((p) => p.name).sort()).toEqual(["alpha", "gamma"]);
  });
  it("status 필터 (dormant)", () => {
    const r = filterPlugins(plugins, "", "all", "dormant");
    expect(r.map((p) => p.name)).toEqual(["beta"]);
  });
  it("status 필터 (missing)", () => {
    const r = filterPlugins(plugins, "", "all", "missing");
    expect(r.map((p) => p.name)).toEqual(["gamma"]);
  });
  it("검색 + marketplace 교차", () => {
    const r = filterPlugins(plugins, "first", "one", "all");
    expect(r.map((p) => p.name)).toEqual(["alpha"]);
  });
  it("빈 쿼리는 전체 통과", () => {
    expect(filterPlugins(plugins, "", "all", "all")).toHaveLength(3);
  });
});
```

- [ ] **Step 2: filter 테스트 실패 확인**

Run: `cd apps/dashboard && pnpm exec vitest run tests/plugin-filter.test.ts`
Expected: FAIL — filterPlugins 미존재

- [ ] **Step 3: filterPlugins 구현**

`apps/dashboard/src/widgets/plugin-catalog/lib/filterPlugins.ts`:

```ts
import type { PluginMeta, PluginStatus } from "@/entities/plugin/client";

export type MarketplaceFilter = string | "all";
export type StatusFilter = PluginStatus | "all";

/** resolved=false 가 enabled 보다 우선 — 경로 없으면 무조건 missing. */
export function pluginStatus(p: PluginMeta): PluginStatus {
  if (!p.resolved) return "missing";
  return p.enabled ? "active" : "dormant";
}

export function filterPlugins(
  plugins: PluginMeta[],
  query: string,
  marketplace: MarketplaceFilter,
  status: StatusFilter,
): PluginMeta[] {
  const q = query.trim().toLowerCase();
  return plugins.filter((p) => {
    if (marketplace !== "all" && p.marketplace !== marketplace) return false;
    if (status !== "all" && pluginStatus(p) !== status) return false;
    if (q === "") return true;
    return p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
  });
}
```

- [ ] **Step 4: filter 테스트 통과 확인**

Run: `cd apps/dashboard && pnpm exec vitest run tests/plugin-filter.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: group 실패 테스트 작성**

`apps/dashboard/tests/plugin-group.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { groupPlugins } from "@/widgets/plugin-catalog/lib/groupPlugins";
import type { PluginMeta, PluginMarketplaceMeta } from "@/entities/plugin/client";

function mk(name: string, mk: string): PluginMeta {
  return {
    id: `${name}@${mk}`, name, marketplace: mk, version: "1", description: "",
    author: "", homepage: "", keywords: [], enabled: true, resolved: true,
    counts: { skills: 0, agents: 0, commands: 0, hooks: false, mcp: false },
    components: { skills: [], agents: [], commands: [] },
  };
}

const marketplaces: Record<string, PluginMarketplaceMeta> = {
  one: { label: "one", count: 2 },
  two: { label: "two", count: 1 },
};

describe("groupPlugins", () => {
  it("marketplace 별로 묶고 count desc 정렬", () => {
    const groups = groupPlugins([mk("a", "one"), mk("b", "two"), mk("c", "one")], marketplaces);
    expect(groups.map((g) => g.slug)).toEqual(["one", "two"]);
    expect(groups[0].plugins.map((p) => p.name)).toEqual(["a", "c"]);
  });

  it("필터로 빈 그룹은 제외", () => {
    const groups = groupPlugins([mk("b", "two")], marketplaces);
    expect(groups.map((g) => g.slug)).toEqual(["two"]);
  });

  it("메타에 없는 marketplace 는 slug 자체를 label 로", () => {
    const groups = groupPlugins([mk("x", "ghost")], marketplaces);
    expect(groups[0].label).toBe("ghost");
  });
});
```

- [ ] **Step 6: group 테스트 실패 확인**

Run: `cd apps/dashboard && pnpm exec vitest run tests/plugin-group.test.ts`
Expected: FAIL — groupPlugins 미존재

- [ ] **Step 7: groupPlugins 구현**

`apps/dashboard/src/widgets/plugin-catalog/lib/groupPlugins.ts`:

```ts
import type { PluginMeta, PluginMarketplaceMeta } from "@/entities/plugin/client";

export interface PluginGroup {
  slug: string;
  label: string;
  count: number;
  plugins: PluginMeta[];
}

/**
 * 필터된 평면 plugin 리스트를 marketplace 별 그룹으로 변환.
 * - 그룹 정렬: 전체 count desc (마켓플레이스 규모 큰 순). 동률은 slug asc.
 * - 빈 그룹(필터로 0개)은 제외.
 * - 그룹 내 plugin 은 입력 순서 보존(호출부가 name asc 정렬해 전달).
 */
export function groupPlugins(
  filtered: PluginMeta[],
  marketplaces: Record<string, PluginMarketplaceMeta>,
): PluginGroup[] {
  const buckets = new Map<string, PluginMeta[]>();
  for (const p of filtered) {
    const bucket = buckets.get(p.marketplace);
    if (bucket) bucket.push(p);
    else buckets.set(p.marketplace, [p]);
  }

  const groups: PluginGroup[] = [];
  for (const [slug, plugins] of buckets) {
    const meta = marketplaces[slug];
    groups.push({
      slug,
      label: meta?.label ?? slug,
      count: meta?.count ?? plugins.length,
      plugins,
    });
  }

  groups.sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
  return groups;
}
```

- [ ] **Step 8: group 테스트 통과 확인**

Run: `cd apps/dashboard && pnpm exec vitest run tests/plugin-group.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 9: Commit**

```bash
git add apps/dashboard/src/widgets/plugin-catalog/lib/ apps/dashboard/tests/plugin-filter.test.ts apps/dashboard/tests/plugin-group.test.ts
git commit -m "feat: filterPlugins + groupPlugins 순수 함수"
```

---

### Task 5: UI 컴포넌트 (배지·리스트·드릴다운 Detail·그룹 섹션)

**Files:**
- Create: `apps/dashboard/src/widgets/plugin-catalog/ui/PluginStatusBadge.tsx`
- Create: `apps/dashboard/src/widgets/plugin-catalog/ui/PluginList.tsx`
- Create: `apps/dashboard/src/widgets/plugin-catalog/ui/PluginDetail.tsx`
- Create: `apps/dashboard/src/widgets/plugin-catalog/ui/PluginGroupSection.tsx`

**Interfaces:**
- Consumes: Task 1 타입(`PluginMeta`, `STATUS_LABEL`), Task 4(`pluginStatus`, `PluginGroup`).
- Produces: `PluginStatusBadge`, `PluginList`, `PluginDetail`, `PluginGroupSection` 컴포넌트 (PluginCatalog가 Task 6에서 소비).

이 Task는 순수 렌더 컴포넌트라 단위 테스트 대신 Task 6의 토글 테스트 + build로 게이트한다 (skill UI 컴포넌트 선례와 동일).

- [ ] **Step 1: PluginStatusBadge 작성**

`apps/dashboard/src/widgets/plugin-catalog/ui/PluginStatusBadge.tsx`:

```tsx
import type { PluginStatus } from "@/entities/plugin/client";
import { STATUS_LABEL } from "@/entities/plugin/client";

const STATUS_STYLE: Record<PluginStatus, string> = {
  active: "border-[var(--color-ok)] text-[var(--color-ok)]",
  dormant: "border-[var(--color-hairline)] text-[var(--color-text-subtle)]",
  missing: "border-[var(--color-high)] text-[var(--color-high)]",
};

export function PluginStatusBadge({ status }: { status: PluginStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${STATUS_STYLE[status]}`}
    >
      <span aria-hidden>{status === "active" ? "●" : status === "dormant" ? "○" : "⚠"}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}
```

> `--color-ok`/`--color-high`/`--color-hairline`/`--color-text-subtle` 토큰이 globals.css에 있는지 확인 (skill TierBadge가 같은 토큰을 쓰므로 존재). 없으면 TierBadge.tsx에서 실제 사용 토큰명으로 교체.

- [ ] **Step 2: 카운트 칩 + PluginList 작성**

`apps/dashboard/src/widgets/plugin-catalog/ui/PluginList.tsx`:

```tsx
import type { PluginMeta } from "@/entities/plugin/client";
import { pluginStatus } from "../lib/filterPlugins";
import { PluginStatusBadge } from "./PluginStatusBadge";

/** 0이 아닌 구성요소 축만 칩으로. boolean 축(hooks/mcp)은 true 일 때만. */
function countChips(p: PluginMeta): string[] {
  const chips: string[] = [];
  if (p.counts.skills) chips.push(`${p.counts.skills} skills`);
  if (p.counts.agents) chips.push(`${p.counts.agents} agents`);
  if (p.counts.commands) chips.push(`${p.counts.commands} cmds`);
  if (p.counts.hooks) chips.push("hooks");
  if (p.counts.mcp) chips.push("MCP");
  return chips;
}

export function PluginList({
  plugins,
  selectedId,
  onSelect,
}: {
  plugins: PluginMeta[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {plugins.map((p) => {
        const chips = countChips(p);
        const selected = p.id === selectedId;
        return (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onSelect(p.id)}
              aria-pressed={selected}
              className={`flex w-full flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors ${
                selected
                  ? "border-[var(--color-accent)] bg-[var(--color-surface-2)]"
                  : "border-[var(--color-hairline)] hover:bg-[var(--color-surface-2)]"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm text-[var(--color-text)]">{p.name}</span>
                <PluginStatusBadge status={pluginStatus(p)} />
              </span>
              {chips.length > 0 && (
                <span className="flex flex-wrap gap-1">
                  {chips.map((c) => (
                    <span
                      key={c}
                      className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]"
                    >
                      {c}
                    </span>
                  ))}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 3: PluginDetail 작성 (드릴다운 핵심)**

`apps/dashboard/src/widgets/plugin-catalog/ui/PluginDetail.tsx`:

```tsx
import type { PluginMeta } from "@/entities/plugin/client";
import { pluginStatus } from "../lib/filterPlugins";
import { PluginStatusBadge } from "./PluginStatusBadge";

function NameList({ title, names }: { title: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-semibold text-[var(--color-text)]">
        {title} <span className="text-[var(--color-text-subtle)]">{names.length}</span>
      </h3>
      <p className="font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
        {names.join(" · ")}
      </p>
    </div>
  );
}

export function PluginDetail({ plugin }: { plugin: PluginMeta | null }) {
  if (!plugin) {
    return (
      <div className="flex min-h-[12rem] items-center justify-center rounded-xl border border-dashed border-[var(--color-hairline)] text-sm text-[var(--color-text-muted)]">
        plugin 을 선택하세요.
      </div>
    );
  }

  const flags: string[] = [];
  if (plugin.counts.hooks) flags.push("Hooks ✓");
  if (plugin.counts.mcp) flags.push("MCP ✓");

  return (
    <article className="flex flex-col gap-4 rounded-xl border border-[var(--color-hairline)] bg-white p-5">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-mono text-lg text-[var(--color-text)]">{plugin.name}</h2>
          <span className="text-xs text-[var(--color-text-subtle)]">v{plugin.version}</span>
          <span className="text-xs text-[var(--color-text-subtle)]">· {plugin.marketplace}</span>
          <PluginStatusBadge status={pluginStatus(plugin)} />
        </div>
        {plugin.description && (
          <p className="text-sm leading-relaxed text-[var(--color-text-muted)]">{plugin.description}</p>
        )}
        {(plugin.author || plugin.homepage) && (
          <p className="text-xs text-[var(--color-text-subtle)]">
            {plugin.author && <span>by {plugin.author}</span>}
            {plugin.author && plugin.homepage && <span> · </span>}
            {plugin.homepage && (
              <a
                href={plugin.homepage}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-[var(--color-accent)]"
              >
                {plugin.homepage.replace(/^https?:\/\//, "")} ↗
              </a>
            )}
          </p>
        )}
      </header>

      {!plugin.resolved ? (
        <p className="rounded-lg border border-dashed border-[var(--color-high)] p-3 text-sm text-[var(--color-text-muted)]">
          설치 경로를 찾을 수 없습니다 — 마켓플레이스에서 제거되었거나 캐시가 삭제된 plugin 입니다.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <NameList title="Skills" names={plugin.components.skills} />
          <NameList title="Agents" names={plugin.components.agents} />
          <NameList title="Commands" names={plugin.components.commands} />
          {flags.length > 0 && (
            <p className="flex gap-2 text-xs text-[var(--color-text-muted)]">
              {flags.map((f) => (
                <span key={f} className="rounded bg-[var(--color-surface-2)] px-2 py-1">
                  {f}
                </span>
              ))}
            </p>
          )}
          {plugin.counts.skills === 0 &&
            plugin.counts.agents === 0 &&
            plugin.counts.commands === 0 &&
            flags.length === 0 && (
              <p className="text-sm text-[var(--color-text-subtle)]">
                노출된 구성요소가 없습니다 (LSP·런타임 전용 plugin).
              </p>
            )}
        </div>
      )}

      {plugin.keywords.length > 0 && (
        <footer className="flex flex-wrap gap-1 border-t border-[var(--color-hairline)] pt-3">
          {plugin.keywords.map((k) => (
            <span key={k} className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-subtle)]">
              {k}
            </span>
          ))}
        </footer>
      )}
    </article>
  );
}
```

- [ ] **Step 4: PluginGroupSection 작성 (접이식)**

`apps/dashboard/src/widgets/plugin-catalog/ui/PluginGroupSection.tsx`:

```tsx
import type { PluginGroup } from "../lib/groupPlugins";
import { PluginList } from "./PluginList";

export function PluginGroupSection({
  group,
  expanded,
  onToggle,
  selectedId,
  onSelect,
}: {
  group: PluginGroup;
  expanded: boolean;
  onToggle: (slug: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => onToggle(group.slug)}
        aria-expanded={expanded}
        className="flex items-center gap-2 text-left text-xs font-semibold text-[var(--color-text-muted)]"
      >
        <span aria-hidden className="font-mono text-[10px]">{expanded ? "▾" : "▸"}</span>
        {group.label}
        <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">{group.plugins.length}</span>
      </button>
      {expanded && (
        <PluginList plugins={group.plugins} selectedId={selectedId} onSelect={onSelect} />
      )}
    </section>
  );
}
```

- [ ] **Step 5: typecheck 통과 확인**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: 에러 없음 (PluginCatalog는 아직 없지만 위 4개는 자기완결적)

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/widgets/plugin-catalog/ui/
git commit -m "feat: plugin 카탈로그 UI (배지·리스트·드릴다운 Detail·그룹 섹션)"
```

---

### Task 6: PluginCatalog 셸 + barrel + 페이지 라우트 + 토글 테스트

**Files:**
- Create: `apps/dashboard/src/widgets/plugin-catalog/ui/PluginCatalog.tsx`
- Create: `apps/dashboard/src/widgets/plugin-catalog/index.ts`
- Create: `apps/dashboard/src/app/(dashboard)/plugins/page.tsx`
- Test: `apps/dashboard/tests/plugin-catalog-toggle.test.tsx`
- Modify: 네비게이션 (사이드바/메뉴에 `/plugins` 링크 — 위치는 skills 링크 옆)

**Interfaces:**
- Consumes: Task 3(`getPlugins`, `getPluginMarketplaces`), Task 4(`filterPlugins`, `groupPlugins`, `MarketplaceFilter`, `StatusFilter`), Task 5(UI 컴포넌트).
- Produces: `PluginCatalog` 컴포넌트, `/plugins` 라우트.

- [ ] **Step 1: PluginCatalog 셸 작성**

`apps/dashboard/src/widgets/plugin-catalog/ui/PluginCatalog.tsx`:

```tsx
"use client";
import { useCallback, useMemo, useState } from "react";
import type { PluginMeta, PluginMarketplaceMeta } from "@/entities/plugin/client";
import { filterPlugins, type StatusFilter } from "../lib/filterPlugins";
import { groupPlugins } from "../lib/groupPlugins";
import { PluginGroupSection } from "./PluginGroupSection";
import { PluginDetail } from "./PluginDetail";

const STATUS_CHIPS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "active", label: "활성" },
  { value: "dormant", label: "휴면" },
  { value: "missing", label: "경로 없음" },
];

export function PluginCatalog({
  plugins,
  marketplaces,
}: {
  plugins: PluginMeta[];
  marketplaces: Record<string, PluginMarketplaceMeta>;
}) {
  const [query, setQuery] = useState("");
  const [marketplace, setMarketplace] = useState<string>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const filtered = useMemo(
    () => filterPlugins(plugins, query, marketplace, status),
    [plugins, query, marketplace, status],
  );
  const groups = useMemo(() => groupPlugins(filtered, marketplaces), [filtered, marketplaces]);

  const searching = query.trim() !== "";
  const isExpanded = useCallback(
    (slug: string) => searching || !collapsed.has(slug),
    [searching, collapsed],
  );
  const toggle = useCallback((slug: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const selected = useMemo(
    () => plugins.find((p) => p.id === selectedId) ?? null,
    [plugins, selectedId],
  );

  // marketplace 칩 — catalog 메타 count desc.
  const marketplaceChips = useMemo(
    () =>
      [{ slug: "all", label: "전체" }].concat(
        Object.entries(marketplaces)
          .sort((a, b) => b[1].count - a[1].count)
          .map(([slug, m]) => ({ slug, label: m.label })),
      ),
    [marketplaces],
  );

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <aside className="flex flex-col gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="plugin 이름·설명 검색"
          aria-label="plugin 검색"
          className="w-full rounded-lg border border-[var(--color-hairline)] bg-white px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus-visible:border-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
        />
        <div role="group" aria-label="상태 필터" className="flex flex-wrap items-center gap-1 text-xs">
          {STATUS_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => setStatus(chip.value)}
              aria-pressed={status === chip.value}
              className={`rounded-md border px-2 py-1 transition-colors ${
                status === chip.value
                  ? "border-[var(--color-accent)] bg-[var(--color-surface-2)] text-[var(--color-text)]"
                  : "border-[var(--color-hairline)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
              }`}
            >
              {chip.label}
            </button>
          ))}
          <span className="ml-auto font-mono text-[var(--color-text-subtle)]">{filtered.length}</span>
        </div>
        <div role="group" aria-label="마켓플레이스 필터" className="flex flex-wrap items-center gap-1 text-xs">
          {marketplaceChips.map((chip) => (
            <button
              key={chip.slug}
              type="button"
              onClick={() => setMarketplace(chip.slug)}
              aria-pressed={marketplace === chip.slug}
              className={`rounded-md border px-2 py-1 transition-colors ${
                marketplace === chip.slug
                  ? "border-[var(--color-accent)] bg-[var(--color-surface-2)] text-[var(--color-text)]"
                  : "border-[var(--color-hairline)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {groups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--color-hairline)] p-4 text-sm text-[var(--color-text-muted)]">
            조건에 맞는 plugin 이 없습니다.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {groups.map((g) => (
              <PluginGroupSection
                key={g.slug}
                group={g}
                expanded={isExpanded(g.slug)}
                onToggle={toggle}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            ))}
          </div>
        )}
      </aside>
      <PluginDetail plugin={selected} />
    </div>
  );
}
```

- [ ] **Step 2: barrel + 페이지 작성**

`apps/dashboard/src/widgets/plugin-catalog/index.ts`:

```ts
export { PluginCatalog } from "./ui/PluginCatalog";
```

`apps/dashboard/src/app/(dashboard)/plugins/page.tsx` — **먼저 skills/page.tsx를 읽어 인증·레이아웃 래퍼를 그대로 미러링**한 뒤:

```tsx
import { getPlugins, getPluginMarketplaces } from "@/entities/plugin/server";
import { PluginCatalog } from "@/widgets/plugin-catalog";

// (skills/page.tsx 의 인증 가드·페이지 헤더 구조를 동일하게 복제 — auth() 등)

export default function PluginsPage() {
  const plugins = getPlugins();
  const marketplaces = getPluginMarketplaces();
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-[var(--color-text)]">Plugins</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          설치된 Claude Code plugin {plugins.length}개 — 마켓플레이스별 구성요소 인벤토리.
        </p>
      </header>
      <PluginCatalog plugins={plugins} marketplaces={marketplaces} />
    </main>
  );
}
```

> skills/page.tsx에 auth 가드나 특정 레이아웃이 있으면 동일하게 적용. 없으면 위 그대로.

- [ ] **Step 3: 토글 테스트 작성 (결정적 — 브라우저 누적 신호 회피)**

`apps/dashboard/tests/plugin-catalog-toggle.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PluginCatalog } from "@/widgets/plugin-catalog/ui/PluginCatalog";
import type { PluginMeta, PluginMarketplaceMeta } from "@/entities/plugin/client";

afterEach(cleanup);

function mk(name: string, marketplace: string): PluginMeta {
  return {
    id: `${name}@${marketplace}`, name, marketplace, version: "1", description: "",
    author: "", homepage: "", keywords: [], enabled: true, resolved: true,
    counts: { skills: 1, agents: 0, commands: 0, hooks: false, mcp: false },
    components: { skills: ["s"], agents: [], commands: [] },
  };
}

const plugins = [mk("alpha", "one"), mk("beta", "two")];
const marketplaces: Record<string, PluginMarketplaceMeta> = {
  one: { label: "one", count: 1 },
  two: { label: "two", count: 1 },
};

describe("PluginCatalog 토글", () => {
  it("그룹 헤더 클릭 시 해당 그룹 plugin 이 사라졌다 나타난다", () => {
    render(<PluginCatalog plugins={plugins} marketplaces={marketplaces} />);
    expect(screen.getByText("alpha")).toBeTruthy();
    // "one" 그룹 헤더 토글 (aria-expanded 버튼)
    const oneHeader = screen.getByRole("button", { name: /one/ });
    fireEvent.click(oneHeader);
    expect(screen.queryByText("alpha")).toBeNull();
    fireEvent.click(oneHeader);
    expect(screen.getByText("alpha")).toBeTruthy();
  });

  it("status 필터 휴면 선택 시 active plugin 숨김", () => {
    render(<PluginCatalog plugins={plugins} marketplaces={marketplaces} />);
    fireEvent.click(screen.getByRole("button", { name: "휴면" }));
    expect(screen.queryByText("alpha")).toBeNull();
  });
});
```

- [ ] **Step 4: 토글 테스트 통과 확인**

Run: `cd apps/dashboard && pnpm exec vitest run tests/plugin-catalog-toggle.test.tsx`
Expected: PASS (2 tests). 만약 그룹 헤더 name 매칭이 카운트 숫자 때문에 애매하면 `name: /^one/` 또는 `getAllByRole`로 조정.

- [ ] **Step 5: 네비게이션에 /plugins 링크 추가**

skills 링크가 있는 네비게이션 파일을 찾아(`grep -rn '/skills' apps/dashboard/src --include=*.tsx | grep -iv test`) 동일 위치에 `/plugins` 링크를 추가. 라벨 "Plugins".

- [ ] **Step 6: 전체 검증 (typecheck + lint + build + 전체 테스트)**

```bash
cd apps/dashboard && pnpm typecheck && pnpm lint && pnpm exec vitest run && pnpm build
```
Expected: 모두 통과. **build는 server/client seam 게이트 — 필수.** PluginCatalog가 `@/entities/plugin/client`만 import하는지(server 누출 없는지) build가 검증.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/widgets/plugin-catalog/ apps/dashboard/src/app/\(dashboard\)/plugins/ apps/dashboard/tests/plugin-catalog-toggle.test.tsx
# + 네비게이션 파일
git commit -m "feat: /plugins 라우트 + PluginCatalog 셸 + 네비 링크"
```

---

## Self-Review

**Spec coverage:**
- 데이터 소스 3개 머지 → Task 2 ✓
- 구성요소 카운트 규칙 → Task 1 ✓
- unresolved 포함+배지 → Task 1(타입) + Task 4(pluginStatus missing) + Task 5(Detail 안내) ✓
- 드릴다운 Detail → Task 5 PluginDetail ✓
- marketplace 그룹 → Task 4 groupPlugins + Task 5 GroupSection ✓
- active/dormant 배지 → Task 5 PluginStatusBadge ✓
- 한글 i18n overlay → Task 2 translations.ko.json 머지 ✓
- 3개 직교 필터 축 → Task 4 filterPlugins ✓
- 테스트 4종 → Task 1·4·6 ✓
- 검증(typecheck/lint/build) → Task 6 Step 6 ✓

**Placeholder scan:** 없음. 모든 코드 블록 완전. 단 두 곳 외부 의존: (a) skills/page.tsx의 auth 래퍼 — "읽어서 미러" 명시, (b) globals.css 토큰명 — "TierBadge 확인" 명시. 둘 다 구현 시 1줄 확인으로 해소.

**Type consistency:** `PluginMeta`/`pluginStatus`/`PluginGroup`/`StatusFilter`/`MarketplaceFilter` 전 Task 일관. `getPlugins`/`getPluginMarketplaces` 시그니처 Task 3 정의 = Task 6 소비 일치. `countComponents` 반환 `{counts, components}` Task 1 = Task 2 소비 일치.

## 비목표 (재확인)
necessity tier·공유 추상화·활성화 토글 액션·미설치 plugin 탐색 — 전부 구현 안 함.
