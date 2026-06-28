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
  body: string; // SKILL.md frontmatter 이후 마크다운 전문
}
