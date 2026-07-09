// 받아쓰기 원문 → AI 정리(transcript normalizer). draft-reply.ts 패턴 미러.
// 요약·판단·할일추출·내용삭제·고유명사변경 금지 — 뜻 보존이 최우선.
import "server-only";
import { z } from "zod";
import { analyzeStructured } from "@krdn/llm-gateway/gateway";
import { gatewayDefaults, logLlmSpend } from "@/shared/lib/llm/anthropic";
import { isRefusalDraft } from "@/shared/lib/llm/draft-reply";

const MAX_INPUT = 20_000;
const CLEANUP_MODEL = "claude-sonnet-5";

export const CleanupResponseSchema = z.object({
  cleaned: z.string().min(1).max(30_000),
});

export type CleanupResult =
  | { kind: "ok"; cleaned: string }
  | { kind: "raw-fallback"; reason: string };

const SYSTEM_PROMPT = `당신은 음성 받아쓰기 원문을 정리하는 transcript normalizer입니다.

할 일:
- 군말("음…", "어…", "그…")·반복·받아쓰기 오류를 제거.
- 문장부호와 문단을 자연스럽게 정리.

금지 (엄수):
- 요약하지 않는다. 원문의 모든 정보를 보존한다.
- 판단·평가·조언·안전 문구를 넣지 않는다.
- 할 일 목록·제목을 만들지 않는다.
- 고유명사·숫자·날짜를 임의로 바꾸지 않는다.
- 내용을 삭제하지 않는다 (군말 제외).

응답은 정리된 텍스트만. JSON: {"cleaned": "정리된 전체 텍스트"}`;

/** 과도 축약/빈 결과 감지 — degenerate면 raw fallback. */
export function isDegenerateCleanup(raw: string, cleaned: string): boolean {
  const c = cleaned.trim();
  if (c.length === 0) return true;
  // 원문 대비 60% 미만으로 줄면 정보 손실로 간주.
  return c.length < raw.trim().length * 0.6;
}

export async function cleanupTranscript(raw: string): Promise<CleanupResult> {
  const input = raw.trim();
  if (input.length === 0) return { kind: "raw-fallback", reason: "empty-input" };
  const truncated = input.slice(0, MAX_INPUT);

  try {
    const { object, usage } = await analyzeStructured(truncated, CleanupResponseSchema, {
      ...gatewayDefaults,
      model: CLEANUP_MODEL,
      systemPrompt: SYSTEM_PROMPT,
      maxOutputTokens: 2000,
    });

    // logLlmSpend는 best-effort (관측이 주 경로를 깨지 않게).
    try {
      logLlmSpend("memo-cleanup", CLEANUP_MODEL, usage);
    } catch {
      /* swallow */
    }

    const cleaned = object.cleaned;
    if (isRefusalDraft(cleaned)) return { kind: "raw-fallback", reason: "refusal" };
    if (isDegenerateCleanup(truncated, cleaned)) return { kind: "raw-fallback", reason: "degenerate" };
    return { kind: "ok", cleaned };
  } catch (e) {
    return { kind: "raw-fallback", reason: e instanceof Error ? e.message : "llm-error" };
  }
}
