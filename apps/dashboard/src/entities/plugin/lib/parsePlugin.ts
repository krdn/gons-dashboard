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
      keywords: Array.isArray(raw.keywords)
        ? raw.keywords.filter((k: unknown) => typeof k === "string")
        : [],
    };
  } catch {
    return empty;
  }
}
