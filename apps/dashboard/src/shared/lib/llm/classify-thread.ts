import "server-only";
import { z } from "zod";
import { analyzeStructured } from "@krdn/llm-gateway/gateway";
import { HAIKU_MODEL, gatewayDefaults } from "./anthropic";

export type LlmSeverity = "high" | "med" | "low";

export interface LlmClassifyInput {
  fromEmail: string;
  fromName?: string;
  subject: string;
  snippet: string;
}

export interface LlmClassifyOutput {
  severity: LlmSeverity;
  reason: string;
  classifiedBy: "llm-haiku";
}

export const LLM_CLASSIFIER_VERSION = "v1.0-haiku-2026-05";

const MAX_BODY_BYTES = 5 * 1024;

// reason.max(80): 영어 reason(평균 50~70자)이 40자 제한에 걸려 Zod 거부 →
// deterministic fallback FP 되던 버그 수정. 프롬프트는 한국어 40자 유지(UI 일관성),
// 스키마는 영어/긴 reason 안전망. export는 직접 단위 테스트(스키마 회귀 가드)용.
export const LlmResponseSchema = z.object({
  needs_reply: z.boolean(),
  severity: z.enum(["high", "med", "low"]),
  reason: z.string().min(1).max(80),
});

const SYSTEM_PROMPT = `당신은 이메일 답장 필요 여부를 판단하는 분류기입니다.
주인공: "내가 답장하지 않으면 상대방이 막혀 있는 메일"만 needs_reply=true.

판단 기준:
- 상대방이 질문/결정/회신을 명시적으로 요청 → needs_reply=true
- 마감/데드라인이 명시되거나 임박 → severity=high
- 일반 질문/요청 → severity=med
- FYI, 공지, 자동 메일, 광고 → needs_reply=false
- 내 답장이 도움 안 되는 시스템 알림 → needs_reply=false

응답은 반드시 JSON 한 줄. reason은 한국어 1줄 (40자 이내).
예: {"needs_reply": true, "severity": "high", "reason": "마감 임박 (3일)"}
예: {"needs_reply": false, "severity": "low", "reason": "자동 알림"}`;

export type LlmClassifyResult =
  | { kind: "needs-reply"; output: LlmClassifyOutput }
  | { kind: "no-reply" }
  | { kind: "llm-unavailable"; error: string };

export async function classifyWithLLM(
  input: LlmClassifyInput,
): Promise<LlmClassifyResult> {
  const truncated = truncateBytes(input.snippet, MAX_BODY_BYTES);

  const userPrompt = [
    `From: ${input.fromName ?? input.fromEmail} <${input.fromEmail}>`,
    `Subject: ${input.subject}`,
    `Snippet: ${truncated}`,
    "",
    "JSON 한 줄로만 응답하세요.",
  ].join("\n");

  try {
    const { object } = await analyzeStructured(userPrompt, LlmResponseSchema, {
      ...gatewayDefaults,
      model: HAIKU_MODEL,
      systemPrompt: SYSTEM_PROMPT,
      maxOutputTokens: 200,
    });

    if (!object.needs_reply) return { kind: "no-reply" };

    return {
      kind: "needs-reply",
      output: {
        severity: object.severity,
        reason: object.reason,
        classifiedBy: "llm-haiku",
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return { kind: "llm-unavailable", error: message };
  }
}

function truncateBytes(input: string, maxBytes: number): string {
  const buffer = Buffer.from(input, "utf-8");
  if (buffer.byteLength <= maxBytes) return input;
  return buffer.subarray(0, maxBytes).toString("utf-8") + "…";
}
