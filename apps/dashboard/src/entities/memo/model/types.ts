import type {
  memos,
  memoTransformations,
  memoTransformPresets,
  memoTransformSettings,
} from "@/shared/lib/db/schema";

export type Memo = typeof memos.$inferSelect;
export type MemoSource = "voice" | "text";

export type MemoTransformation = typeof memoTransformations.$inferSelect;
export type MemoTransformPreset = typeof memoTransformPresets.$inferSelect;
export type MemoTransformSettings = typeof memoTransformSettings.$inferSelect;

// 공급사 키와 프록시에서 선택한 실제 모델 ID를 함께 저장한다.
export const MEMO_MODEL_KEYS = ["claude", "codex", "gemini"] as const;
export type MemoModelKey = (typeof MEMO_MODEL_KEYS)[number];
export const DEFAULT_MEMO_MODEL_KEY: MemoModelKey = "claude";

export interface MemoModelSelection {
  model: MemoModelKey;
  modelId: string;
}

export type MemoModelCatalog = Record<MemoModelKey, string[]>;

export const MEMO_MODEL_META: Record<
  MemoModelKey,
  { label: string; shortLabel: string; description: string }
> = {
  claude: {
    label: "Anthropic (Claude)",
    shortLabel: "Claude",
    description: "균형 잡힌 품질과 지시문 준수 — 기본 모델",
  },
  codex: {
    label: "OpenAI (Codex/GPT)",
    shortLabel: "Codex",
    description: "간결하고 구조적인 정리에 적합",
  },
  gemini: {
    label: "Google (Gemini)",
    shortLabel: "Gemini",
    description: "긴 문맥과 자연스러운 문장 정리에 적합",
  },
};

export function isMemoModelKey(value: unknown): value is MemoModelKey {
  return (
    typeof value === "string" &&
    (MEMO_MODEL_KEYS as readonly string[]).includes(value)
  );
}

/** 프록시 모델 ID가 선택한 공급사 계열인지 확인한다. */
export function isMemoModelIdForProvider(
  provider: MemoModelKey,
  modelId: string,
): boolean {
  const id = modelId.toLowerCase();
  switch (provider) {
    case "claude":
      return id.startsWith("claude-");
    case "codex":
      return id.startsWith("gpt-") || /^o\d/.test(id) || id.includes("codex");
    case "gemini":
      return id.startsWith("gemini-");
  }
}

// 빌트인 프리셋 목록 (커스텀은 DB memo_transform_presets).
export const TRANSFORM_PRESET_IDS = [
  "tidy",
  "polish",
  "summary",
  "structured",
  "todos",
  "journal",
  "email",
] as const;
export type TransformPresetId = (typeof TRANSFORM_PRESET_IDS)[number];

// 칩·다이얼로그 표시 라벨. entities에 두는 이유: MemoCard(entity ui)는
// features를 import할 수 없다 (FSD 방향) — features/memo-transform이 이걸 참조.
export const TRANSFORM_PRESET_LABELS: Record<TransformPresetId, string> = {
  tidy: "정돈",
  polish: "매끄럽게",
  summary: "요약",
  structured: "구조화",
  todos: "할 일 추출",
  journal: "일기체",
  email: "이메일 초안",
};

const MAX_TITLE_LEN = 50;

/** cleaned_content 첫 문장에서 제목 파생. 저장 시점에 title 확정값 생성용. */
export function deriveTitle(cleaned: string): string {
  const trimmed = cleaned.trim();
  if (trimmed.length === 0) return "(제목 없음)";
  // 첫 문장 (마침표/물음표/느낌표 기준). 없으면 전체.
  const firstSentence = trimmed.split(/[.!?。\n]/)[0].trim();
  const base = firstSentence.length > 0 ? firstSentence : trimmed;
  return base.length > MAX_TITLE_LEN ? base.slice(0, MAX_TITLE_LEN) : base;
}
