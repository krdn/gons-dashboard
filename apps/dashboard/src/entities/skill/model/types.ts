// skill entity — Claude Code 스킬 카탈로그 타입.
// catalog.json(메타) 과 public/skill-catalog/<name>.json(본문) 의 형태를 정의.

export type SkillSource = "standalone" | "personal";

export const SOURCE_LABEL: Record<SkillSource, string> = {
  standalone: "직접 설치",
  personal: "개인 (.agents)",
};

// 미분류 fallback — categories.json 에 누락된 스킬에 부여 (snapshot 이 주입).
// SOURCE_LABEL 패턴: slug 와 표시 label 분리.
export const UNCATEGORIZED = "uncategorized";
export const UNCATEGORIZED_LABEL = "기타";

// 필요도 등급 (범용 개발 생산성 기준 평가 결과). categories 와 직교하는 평가 축.
// necessity.json(committed source) 에서 snapshot 이 각 meta.necessity 로 주입.
export type SkillTier = "high" | "medium" | "low" | "remove" | "unrated";

// 표시 순서: 상(1) → 중(2) → 하(3) → 삭제(4) → 미평가(5).
export const TIER_LABEL: Record<SkillTier, string> = {
  high: "상",
  medium: "중",
  low: "하",
  remove: "삭제 가능",
  unrated: "미평가",
};
export const TIER_ORDER: Record<SkillTier, number> = {
  high: 1,
  medium: 2,
  low: 3,
  remove: 4,
  unrated: 5,
};

// 리스트(catalog.json)에 담기는 경량 메타데이터 — body 없음.
export interface SkillMeta {
  name: string;
  description: string;
  version: string | null;
  model: string | null;
  source: SkillSource;
  category: string; // categories.json 의 slug (snapshot 빌드 시 주입). 미매핑 시 UNCATEGORIZED.
  necessity: SkillTier; // necessity.json 의 등급 (snapshot 주입). 미매핑 시 "unrated".
  necessityReason: string; // 그 등급인 사유 (디테일 패널 표시용). 미매핑 시 "".
  filePath: string; // 원본 SKILL.md 경로 (~/ 축약, 표시용)
  bodyPath: string; // "/skill-catalog/<sanitized-name>.json" (fetch URL)
}

// public/skill-catalog/<name>.json 의 형태.
export interface SkillBody {
  body: string; // SKILL.md frontmatter 이후 마크다운 전문 (원문, 영어 보존)
  summaryKo?: string; // 한글 "한눈에" 요약 (overlay 있을 때만). 본문과 분리 저장하여
  //                     SkillDetail 이 전용 박스로 렌더 — 본문의 native blockquote 와 충돌 방지.
}

// 한글 번역 overlay (translations.ko.json) 의 항목.
// 원본 SKILL.md(repo 밖, 영어 트리거라 불가침)는 건드리지 않고,
// snapshot 빌드 시점에 catalog/body 로 merge 된다. name 으로 키잉.
export interface SkillTranslation {
  description?: string; // catalog 리스트/헤더에 표시될 한글 한 줄 설명
  summary?: string; // body 맨 위에 prepend 될 "한눈에" 한글 요약 (마크다운, 줄당 1줄)
  body?: string; // 본문 전체를 이 한글 마크다운으로 교체 (원문이 영어가 아닌 예외 스킬용).
  //                대부분 스킬은 본문이 영어라 미사용 — agent-reach 처럼 원문이 중국어일 때만 채운다.
}

export type SkillTranslations = Record<string, SkillTranslation>;

// ── 카테고리 (구조 축, translations 와 분리) ──

// categories.json (committed source — 사람이 편집) 의 항목.
// snapshot 이 skills[] 를 역인덱싱해 각 meta.category 를 채운다.
export interface SkillCategoryDef {
  label: string; // 섹션 헤더에 표시할 한글 label
  order: number; // 표시 순서 (의미 순서: 1=계획, 2=코드품질, …)
  skills: string[]; // 이 카테고리에 속한 스킬 name 목록
}
export type SkillCategoryDefs = Record<string, SkillCategoryDef>;

// UI 가 섹션 헤더·순서를 알기 위한 경량 메타 (label/order 만, skills 제외).
// snapshot 이 catalog.json envelope 에 함께 담아 출력한다.
export interface SkillCategoryMeta {
  label: string;
  order: number;
}
export type SkillCategoryMetaMap = Record<string, SkillCategoryMeta>;

// catalog.json (generated) 의 형태 — SkillMeta[] 에서 envelope 로 전환.
// skills: 경량 메타 배열, categories: slug → {label, order} 맵.
export interface SkillCatalog {
  skills: SkillMeta[];
  categories: SkillCategoryMetaMap;
}
