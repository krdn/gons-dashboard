// skill entity — Claude Code 스킬 카탈로그 타입.
// catalog.json(메타) 과 public/skill-catalog/<name>.json(본문) 의 형태를 정의.

export type SkillSource = "standalone" | "personal";

export const SOURCE_LABEL: Record<SkillSource, string> = {
  standalone: "직접 설치",
  personal: "개인 (.agents)",
};

// 리스트(catalog.json)에 담기는 경량 메타데이터 — body 없음.
export interface SkillMeta {
  name: string;
  description: string;
  version: string | null;
  model: string | null;
  source: SkillSource;
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
}

export type SkillTranslations = Record<string, SkillTranslation>;
