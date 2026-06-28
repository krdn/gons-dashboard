import { describe, it, expect } from "vitest";
import { groupSkills } from "@/widgets/skill-catalog/lib/groupSkills";
import type { SkillMeta, SkillCategoryMetaMap } from "@/entities/skill/client";

// 테스트용 경량 SkillMeta 빌더 — name + category 만 의미 있고 나머지는 더미.
function skill(name: string, category: string): SkillMeta {
  return {
    name,
    description: `${name} 설명`,
    version: null,
    model: null,
    source: "standalone",
    category,
    necessity: "unrated",
    necessityReason: "",
    filePath: `~/.claude/skills/${name}/SKILL.md`,
    bodyPath: `/skill-catalog/${name}.json`,
  };
}

const META: SkillCategoryMetaMap = {
  "planning-spec": { label: "계획·스펙", order: 1 },
  "code-quality": { label: "코드 품질", order: 2 },
  "design-ux": { label: "디자인·UX", order: 3 },
};

describe("groupSkills", () => {
  it("category order asc 로 그룹 정렬", () => {
    const groups = groupSkills(
      [skill("design-review", "design-ux"), skill("spec", "planning-spec"), skill("qa", "code-quality")],
      META,
    );
    expect(groups.map((g) => g.slug)).toEqual(["planning-spec", "code-quality", "design-ux"]);
    expect(groups.map((g) => g.order)).toEqual([1, 2, 3]);
  });

  it("빈 그룹(필터로 0개)은 결과에서 제외", () => {
    // code-quality 에 속한 스킬이 하나도 없으면 그 그룹은 안 나옴.
    const groups = groupSkills([skill("spec", "planning-spec")], META);
    expect(groups).toHaveLength(1);
    expect(groups[0].slug).toBe("planning-spec");
  });

  it("그룹 헤더에 label + 그룹 내 스킬 개수가 정확", () => {
    const groups = groupSkills(
      [skill("spec", "planning-spec"), skill("to-prd", "planning-spec"), skill("qa", "code-quality")],
      META,
    );
    const planning = groups.find((g) => g.slug === "planning-spec");
    expect(planning?.label).toBe("계획·스펙");
    expect(planning?.skills).toHaveLength(2);
    expect(groups.find((g) => g.slug === "code-quality")?.skills).toHaveLength(1);
  });

  it("그룹 내 스킬은 입력 순서 보존 (호출부가 name asc 로 전달)", () => {
    const groups = groupSkills(
      [skill("a-skill", "planning-spec"), skill("b-skill", "planning-spec")],
      META,
    );
    expect(groups[0].skills.map((s) => s.name)).toEqual(["a-skill", "b-skill"]);
  });

  it("categoryMeta 에 없는 slug 는 '기타' 그룹으로 맨 끝에 모음", () => {
    const groups = groupSkills(
      [skill("ghost", "nonexistent-cat"), skill("spec", "planning-spec")],
      META,
    );
    expect(groups[0].slug).toBe("planning-spec"); // 알려진 카테고리 먼저
    const last = groups[groups.length - 1];
    expect(last.slug).toBe("uncategorized");
    expect(last.label).toBe("기타");
    expect(last.skills.map((s) => s.name)).toEqual(["ghost"]);
  });

  it("빈 입력 → 빈 그룹 배열", () => {
    expect(groupSkills([], META)).toEqual([]);
  });

  it("category 빈 문자열도 '기타'로 처리 (graceful)", () => {
    const groups = groupSkills([skill("orphan", "")], META);
    expect(groups).toHaveLength(1);
    expect(groups[0].slug).toBe("uncategorized");
  });
});
