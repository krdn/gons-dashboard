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
