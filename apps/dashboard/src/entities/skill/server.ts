// skill entity — server-only entrypoint.
// RSC, scripts 에서 사용. catalog.json 은 빌드 시점에 생성된 committed 메타데이터.
import "server-only";

import catalog from "./catalog.json";
import type { SkillMeta } from "./model/types";

export function getSkills(): SkillMeta[] {
  return catalog as SkillMeta[];
}

export type { SkillMeta, SkillBody, SkillSource } from "./model/types";
