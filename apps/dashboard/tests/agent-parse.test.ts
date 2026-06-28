// parseAgent 순수 테스트 — 위험은 파서에 집중된다(복붙 레이어엔 버그 안 생김).
// 세 까다로운 케이스: claude-flow 멀티라인 frontmatter, tools 다형(array/CSV/없음), model 정규화.
import { describe, it, expect } from "vitest";
import {
  toMeta,
  normalizeModel,
  normalizeTools,
  sanitizeName,
} from "@/entities/agent/lib/parseAgent";

describe("normalizeModel", () => {
  it("bare tier 를 그대로 인식한다", () => {
    expect(normalizeModel("opus")).toBe("opus");
    expect(normalizeModel("sonnet")).toBe("sonnet");
    expect(normalizeModel("haiku")).toBe("haiku");
  });
  it("full model id 에서 tier 를 추출한다", () => {
    expect(normalizeModel("claude-opus-4-8")).toBe("opus");
    expect(normalizeModel("claude-sonnet-4-6")).toBe("sonnet");
  });
  it("null/undefined/미인식은 inherit 로 폴백한다", () => {
    expect(normalizeModel(undefined)).toBe("inherit");
    expect(normalizeModel(null)).toBe("inherit");
    expect(normalizeModel("gpt-5")).toBe("inherit");
    expect(normalizeModel("inherit")).toBe("inherit");
  });
});

describe("normalizeTools", () => {
  it("JSON 배열을 string[] 로 정규화한다", () => {
    expect(normalizeTools(["Read", "Grep", "Glob"])).toEqual(["Read", "Grep", "Glob"]);
  });
  it("CSV 문자열을 string[] 로 정규화한다", () => {
    expect(normalizeTools("Read, Bash, Grep")).toEqual(["Read", "Bash", "Grep"]);
  });
  it("없으면(undefined) 빈 배열을 반환한다", () => {
    expect(normalizeTools(undefined)).toEqual([]);
    expect(normalizeTools(null)).toEqual([]);
  });
});

describe("sanitizeName", () => {
  it("콜론·슬래시·공백을 하이픈으로 치환한다", () => {
    expect(sanitizeName("gon:evolve")).toBe("gon-evolve");
    expect(sanitizeName("a/b c")).toBe("a-b-c");
  });
});

describe("toMeta", () => {
  it("표준 frontmatter(architect 형) 를 파싱한다", () => {
    const raw = `---
name: architect
description: Software architecture specialist.
tools: ["Read", "Grep", "Glob"]
model: opus
---

You are a senior software architect.`;
    const meta = toMeta({
      fileBase: "architect",
      rawContent: raw,
      isSymlink: false,
      filePath: "~/.claude/agents/architect.md",
    });
    expect(meta.name).toBe("architect");
    expect(meta.model).toBe("opus");
    expect(meta.tools).toEqual(["Read", "Grep", "Glob"]);
    expect(meta.source).toBe("personal");
    expect(meta.bodyPath).toBe("/agent-catalog/architect.json");
  });

  it("symlink 는 framework 로 분류한다(skill 과 반전)", () => {
    const raw = `---
name: code-reviewer
description: Expert code review specialist.
tools: Read, Grep, Glob, Bash
model: sonnet
---

body`;
    const meta = toMeta({
      fileBase: "code-reviewer",
      rawContent: raw,
      isSymlink: true,
      filePath: "~/.claude/agents/code-reviewer.md",
    });
    expect(meta.source).toBe("framework");
    expect(meta.tools).toEqual(["Read", "Grep", "Glob", "Bash"]); // CSV 정규화
  });

  it("claude-flow 멀티라인 frontmatter(coder 형) 를 throw 없이 파싱한다", () => {
    // type/capabilities[]/hooks(멀티라인 셸 블록) — model/tools 부재.
    const raw = `---
name: coder
type: developer
description: Implementation specialist for writing clean code
capabilities:
  - code_generation
  - refactoring
hooks:
  pre: |
    echo "💻 Coder agent: $TASK"
    npx claude-flow@v3alpha hooks pre-task --description "$TASK"
---

# Code Implementation Agent`;
    const meta = toMeta({
      fileBase: "coder",
      rawContent: raw,
      isSymlink: false,
      filePath: "~/.claude/agents/coder.md",
    });
    expect(meta.name).toBe("coder");
    expect(meta.model).toBe("inherit"); // model 없음 → inherit
    expect(meta.tools).toEqual([]); // tools 없음 → 빈 배열
    expect(meta.description).toBe("Implementation specialist for writing clean code");
  });

  it("name 누락 시 파일명 base 로 폴백한다", () => {
    const meta = toMeta({
      fileBase: "fallback-name",
      rawContent: `---\ndescription: x\n---\nbody`,
      isSymlink: false,
      filePath: "~/x.md",
    });
    expect(meta.name).toBe("fallback-name");
  });
});
