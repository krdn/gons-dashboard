// plugin installPath 하위를 스캔해 구성요소 카운트 + manifest 메타 추출.
// fs 직접 사용 — 스냅샷 스크립트(server tree) 전용. 경로 문자열만 받는다.
import { readdirSync, existsSync, readFileSync } from "node:fs";
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

/**
 * hooks/hooks.json 안의 hook command 총 개수를 센다.
 * 구조: { hooks: { <EventName>: [{ matcher, hooks: [{ type, command }, ...] }, ...] } }.
 * 파일 없거나 깨졌으면 0 (배지 미표시). skills/agents/commands 와 같은 "출하 항목 수" 의미.
 */
function countHooks(installPath: string): number {
  const hooksJson = join(installPath, "hooks", "hooks.json");
  if (!existsSync(hooksJson)) return 0;
  try {
    const raw = JSON.parse(readFileSync(hooksJson, "utf8"));
    const events = raw?.hooks;
    if (events == null || typeof events !== "object") return 0;
    let total = 0;
    for (const matchers of Object.values(events)) {
      if (!Array.isArray(matchers)) continue;
      for (const m of matchers) {
        if (Array.isArray(m?.hooks)) total += m.hooks.length;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * MCP 정의는 두 방식이 있다 (둘 다 Claude Code 공식 스펙):
 *   1) 독립 `.mcp.json` 파일 (context7·playwright)
 *   2) `plugin.json` 의 `mcpServers` 키 인라인 (chrome-devtools-mcp)
 * 둘 중 하나라도 있으면 MCP plugin.
 */
function hasMcp(installPath: string): boolean {
  if (existsSync(join(installPath, ".mcp.json"))) return true;
  const manifestPath = join(installPath, ".claude-plugin", "plugin.json");
  if (!existsSync(manifestPath)) return false;
  try {
    const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    return raw?.mcpServers != null && Object.keys(raw.mcpServers).length > 0;
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
  const hooks = countHooks(installPath);
  const mcp = hasMcp(installPath);
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
      keywords: Array.isArray(raw.keywords)
        ? raw.keywords.filter((k: unknown) => typeof k === "string")
        : [],
    };
  } catch {
    return empty;
  }
}
