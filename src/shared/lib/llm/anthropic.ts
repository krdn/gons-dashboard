// Anthropic SDK 클라이언트 — 사용자의 Claude Code CLI Proxy를 향함.
//
// CLAUDE.md 정책: ANTHROPIC_BASE_URL=http://192.168.0.5:8317
// SDK가 환경변수를 자동 인식하지만, 명시적으로 baseURL/apiKey를 넘겨 의존을 코드에 박는다.
//
// 모델: claude-haiku-4-5 (분류는 가벼운 모델로 충분, 사용자 글로벌 규칙).
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/shared/config/env";

export const anthropic = new Anthropic({
  baseURL: env.ANTHROPIC_BASE_URL,
  apiKey: env.ANTHROPIC_API_KEY,
});

export const HAIKU_MODEL = "claude-haiku-4-5";
