// agent entity — Claude Code 서브에이전트 카탈로그 타입.
// agent-catalog.json(메타) 과 public/agent-catalog/<name>.json(본문) 의 형태를 정의.
// skill 카탈로그와 동형이되 단순화: category/necessity/i18n 없음, model 을 1급 축으로.

// 일반 파일 = 개인(~/.claude/agents 직접), symlink = 프레임워크(frameworks/krdn-claude 미러).
// ⚠️ skill 의 source 의미와 반전 — skill 은 symlink=personal 이지만 agent 는 symlink=framework.
export type AgentSource = "personal" | "framework";

export const SOURCE_LABEL: Record<AgentSource, string> = {
  personal: "개인",
  framework: "프레임워크",
};

// model frontmatter 정규화 결과 — null/미지정/미인식은 "inherit"(부모 세션 모델 상속).
export type AgentModel = "opus" | "sonnet" | "haiku" | "inherit";

export const MODEL_LABEL: Record<AgentModel, string> = {
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
  inherit: "상속(미지정)",
};

// 리스트(agent-catalog.json)에 담기는 경량 메타데이터 — body 없음.
export interface AgentMeta {
  name: string;
  description: string;
  model: AgentModel; // 정규화 후 항상 존재 (null → "inherit")
  tools: string[]; // array | comma-string | undefined → string[] (빈 배열 가능)
  source: AgentSource;
  filePath: string; // 원본 .md 경로 (~/ 축약, 표시용)
  bodyPath: string; // "/agent-catalog/<sanitized-name>.json" (fetch URL)
}

// public/agent-catalog/<name>.json 의 형태. (skill 과 달리 summaryKo 없음 — i18n 보류)
export interface AgentBody {
  body: string; // .md frontmatter 이후 마크다운 전문 (원문)
}

// agent-catalog.json (generated) 의 형태 — 단일 envelope (skill 의 categories 없음).
export interface AgentCatalog {
  agents: AgentMeta[];
}
