// 사주 narrative 분석에 사용할 LLM 모델 선택 registry (v0.3.2).
//
// 정책 (spec 2026-05-20):
//  - 단일 ANTHROPIC_BASE_URL 프록시가 model ID 문자열로 백엔드(Claude/Codex/Gemini) 분기
//  - UI 는 키(claude|codex|gemini)만 다루고, 실제 모델 ID는 env 에서 주입
//  - parseSajuModelKey 는 never throw — 잘못된 URL 입력 시 'claude' 로 폴백
import "server-only";
import { env } from "@/shared/config/env";

export const SAJU_MODEL_KEYS = ["claude", "codex", "gemini"] as const;
export type SajuModelKey = (typeof SAJU_MODEL_KEYS)[number];

export interface SajuModelInfo {
  id: string;
  label: string;
  vendor: string;
  description: string;
}

export const SAJU_MODEL_REGISTRY: Record<SajuModelKey, SajuModelInfo> = {
  claude: {
    id: env.SAJU_LLM_MODEL_CLAUDE,
    label: "Claude Opus 4.7",
    vendor: "Anthropic",
    description: "Anthropic Claude Opus 4.7 — 기본 모델, narrative schema 준수도 높음",
  },
  codex: {
    id: env.SAJU_LLM_MODEL_CODEX,
    label: "Codex (GPT-5)",
    vendor: "OpenAI",
    description: "OpenAI Codex (GPT-5 기반) — 비교 분석용 대안 모델",
  },
  gemini: {
    id: env.SAJU_LLM_MODEL_GEMINI,
    label: "Gemini 2.5 Pro",
    vendor: "Google",
    description: "Google Gemini 2.5 Pro — 비교 분석용 대안 모델",
  },
};

export const DEFAULT_SAJU_MODEL_KEY: SajuModelKey = "claude";

/**
 * URL search param 으로 들어온 raw 값을 안전하게 SajuModelKey 로 정규화.
 * Never throws — 잘못된 입력은 DEFAULT_SAJU_MODEL_KEY 로 폴백.
 */
export function parseSajuModelKey(raw: unknown): SajuModelKey {
  if (typeof raw !== "string") return DEFAULT_SAJU_MODEL_KEY;
  return (SAJU_MODEL_KEYS as readonly string[]).includes(raw)
    ? (raw as SajuModelKey)
    : DEFAULT_SAJU_MODEL_KEY;
}
