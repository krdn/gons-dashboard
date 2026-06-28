import {
  UNCATEGORIZED,
  UNCATEGORIZED_LABEL,
  type SkillMeta,
  type SkillCategoryMetaMap,
} from "@/entities/skill/client";

export interface SkillGroup {
  slug: string;
  label: string;
  order: number;
  skills: SkillMeta[];
}

// 미분류 그룹은 항상 맨 끝. categories 에 정의된 order(1~N) 보다 크게.
const UNCATEGORIZED_ORDER = Number.MAX_SAFE_INTEGER;

/**
 * 필터된 평면 스킬 리스트를 카테고리별 그룹 배열로 변환.
 * - filterSkills(source/query) 출력을 입력으로 받음 — 그룹핑은 필터와 직교.
 * - 빈 그룹(필터로 0개)은 결과에서 제외.
 * - 그룹 정렬: order asc. 그룹 내 스킬은 입력 순서 보존(호출부가 name asc 로 정렬해 전달).
 * - categoryMeta 에 없는 slug(미분류)는 "기타" 그룹으로 모아 맨 끝.
 */
export function groupSkills(
  filtered: SkillMeta[],
  categoryMeta: SkillCategoryMetaMap,
): SkillGroup[] {
  const buckets = new Map<string, SkillMeta[]>();
  for (const skill of filtered) {
    const slug = skill.category || UNCATEGORIZED;
    const known = categoryMeta[slug] ? slug : UNCATEGORIZED;
    const bucket = buckets.get(known);
    if (bucket) bucket.push(skill);
    else buckets.set(known, [skill]);
  }

  const groups: SkillGroup[] = [];
  for (const [slug, skills] of buckets) {
    const meta = categoryMeta[slug];
    groups.push({
      slug,
      label: meta?.label ?? UNCATEGORIZED_LABEL,
      order: meta?.order ?? UNCATEGORIZED_ORDER,
      skills,
    });
  }

  groups.sort((a, b) => a.order - b.order);
  return groups;
}
