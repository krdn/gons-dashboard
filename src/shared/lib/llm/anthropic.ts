// Anthropic SDK 클라이언트 — 사용자의 Claude Code CLI Proxy를 향함.
//
// CLAUDE.md 정책: ANTHROPIC_BASE_URL=http://192.168.0.5:8317
// SDK가 환경변수를 자동 인식하지만, 명시적으로 baseURL/apiKey를 넘겨 의존을 코드에 박는다.
//
// 모델: dated suffix까지 포함된 정확한 ID여야 프록시가 알아본다 ("unknown provider for model"
// 응답을 피함). 모델 갱신 시 한 곳만 수정하면 reply_needed·important 두 분류기에 동시 반영.
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/shared/config/env";

export const anthropic = new Anthropic({
  baseURL: env.ANTHROPIC_BASE_URL,
  apiKey: env.ANTHROPIC_API_KEY,
});

export const HAIKU_MODEL = "claude-haiku-4-5-20251001";
