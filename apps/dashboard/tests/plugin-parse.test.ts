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

  it(".mcp.json 파일 방식 MCP 인식", () => {
    const dir = mkdtempSync(join(tmpdir(), "plugin-mcp-file-"));
    writeFileSync(join(dir, ".mcp.json"), "{}");
    expect(countComponents(dir).counts.mcp).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("plugin.json mcpServers 인라인 방식 MCP 인식 (chrome-devtools-mcp 패턴)", () => {
    const dir = mkdtempSync(join(tmpdir(), "plugin-mcp-inline-"));
    mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(dir, ".claude-plugin", "plugin.json"),
      JSON.stringify({ mcpServers: { foo: { command: "npx", args: ["foo"] } } }),
    );
    // .mcp.json 은 없지만 plugin.json 인라인 정의로 MCP=true 여야 한다.
    expect(countComponents(dir).counts.mcp).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("빈 mcpServers 객체는 MCP 아님", () => {
    const dir = mkdtempSync(join(tmpdir(), "plugin-mcp-empty-"));
    mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
    writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ mcpServers: {} }));
    expect(countComponents(dir).counts.mcp).toBe(false);
    rmSync(dir, { recursive: true, force: true });
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
