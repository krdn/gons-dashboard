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
    category: "uncategorized",
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
