// skill entity — server-only entrypoint.
// RSC, scripts 에서 사용. catalog.json 은 빌드 시점에 생성된 committed 메타데이터.
// 형태: { skills: SkillMeta[], categories: slug→{label,order} } envelope.
import "server-only";

import catalog from "./catalog.json";
import type { SkillMeta, SkillCatalog, SkillCategoryMetaMap } from "./model/types";

const data = catalog as SkillCatalog;

export function getSkills(): SkillMeta[] {
  return data.skills;
}

/** 카테고리 섹션 메타 (slug → {label, order}). UI 그룹 헤더·순서용. */
export function getSkillCategories(): SkillCategoryMetaMap {
  return data.categories;
}

export type {
  SkillMeta,
  SkillBody,
  SkillSource,
  SkillCategoryMeta,
  SkillCategoryMetaMap,
} from "./model/types";
