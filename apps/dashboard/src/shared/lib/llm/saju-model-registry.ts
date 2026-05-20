// 사주 narrative 분석에 사용할 LLM 모델 선택 registry — server side (v0.3.2).
//
// 정책 (spec 2026-05-20):
//  - 단일 ANTHROPIC_BASE_URL 프록시가 model ID 문자열로 백엔드(Claude/Codex/Gemini) 분기
//  - UI 는 ./saju-model-registry-meta 에서 키/라벨/parser 만 가져온다 (client safe)
//  - 이 파일은 env 에 접근하므로 server-only — narrative-server 와 API route 에서만 import
import "server-only";
import { env } from "@/shared/config/env";
import {
  SAJU_MODEL_KEYS,
  SAJU_MODEL_META,
  DEFAULT_SAJU_MODEL_KEY,
  parseSajuModelKey,
  type SajuModelKey,
  type SajuModelMeta,
} from "./saju-model-registry-meta";

export {
  SAJU_MODEL_KEYS,
  DEFAULT_SAJU_MODEL_KEY,
  parseSajuModelKey,
  type SajuModelKey,
};

export interface SajuModelInfo extends SajuModelMeta {
  id: string;
}

export const SAJU_MODEL_REGISTRY: Record<SajuModelKey, SajuModelInfo> = {
  claude: { ...SAJU_MODEL_META.claude, id: env.SAJU_LLM_MODEL_CLAUDE },
  codex: { ...SAJU_MODEL_META.codex, id: env.SAJU_LLM_MODEL_CODEX },
  gemini: { ...SAJU_MODEL_META.gemini, id: env.SAJU_LLM_MODEL_GEMINI },
};
