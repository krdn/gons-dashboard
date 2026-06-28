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
