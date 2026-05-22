import { wallStreet } from "./wallStreet";
import { krExpert } from "./krExpert";
import { value } from "./value";
import { growth } from "./growth";
import { technical } from "./technical";
import type { PromptBuilder } from "./types";
import type { PersonaKey } from "../schemas/persona";

export type { PersonaInput, BuiltPrompt, PromptBuilder } from "./types";

export const PERSONA_BUILDERS: Record<PersonaKey, PromptBuilder> = {
  wallStreet,
  krExpert,
  value,
  growth,
  technical,
};

// Cache invalidation key — bump 시 모든 이전 cache row 가 매칭 안 됨 → 다음 호출에서 재분석.
// v1: 초기 페르소나 프롬프트 (entities/stock-analysis/server.ts 의 PROMPT_VERSION="v1.0").
// v2: PR 2 — DART trailing 지표 노출 + value/growth 프롬프트 갱신.
export const PERSONA_PROMPT_VERSION = "v2";
