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

  const installed = loadJson<{
    plugins: Record<string, Array<{ installPath: string; version: string }>>;
  }>(PLUGINS_JSON, { plugins: {} });
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
      : {
          counts: { skills: 0, agents: 0, commands: 0, hooks: false, mcp: false },
          components: { skills: [], agents: [], commands: [] },
        };
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
