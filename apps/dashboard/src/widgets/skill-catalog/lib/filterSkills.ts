import type { SkillMeta, SkillSource, SkillTier } from "@/entities/skill/client";

export type SourceFilter = SkillSource | "all";
export type TierFilter = SkillTier | "all";

export function filterSkills(
  skills: SkillMeta[],
  query: string,
  source: SourceFilter,
  tier: TierFilter = "all",
): SkillMeta[] {
  const q = query.trim().toLowerCase();
  return skills.filter((s) => {
    if (source !== "all" && s.source !== source) return false;
    if (tier !== "all" && s.necessity !== tier) return false;
    if (q === "") return true;
    return (
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
    );
  });
}
