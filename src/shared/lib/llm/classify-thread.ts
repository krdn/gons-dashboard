// LLM 정밀 분류기 — deterministic이 후보로 분류한 스레드만 검증.
//
// 안전장치:
//  - Zod 검증 실패 시 fallback (deterministic only)
//  - 프록시 다운 시 graceful degrade
//
// 출력 계약: { needsReply: bool, severity, reason }
//   - reason은 1줄 한국어 (UI 뱃지에 그대로 표시)
//   - 환각 방지: 메시지 본문/snippet은 5KB로 절단
import "server-only";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, HAIKU_MODEL } from "./anthropic";

// 분류 LLM의 입출력 타입 — shared 레이어 자체 타입.
// features/email-analysis가 entities/email/model/ThreadInput을 이 형태로 변환해서 호출.
export type LlmSeverity = "high" | "med" | "low";

export interface LlmClassifyInput {
  fromEmail: string;
  fromName?: string;
  subject: string;
  /** UTF-8 ≤ 5KB 보장 책임은 호출자 측 (또는 이 함수가 절단). */
  snippet: string;
}

export interface LlmClassifyOutput {
  severity: LlmSeverity;
  reason: string;
  classifiedBy: "llm-haiku";
}

export const LLM_CLASSIFIER_VERSION = "v1.0-haiku-2026-05";

const MAX_BODY_BYTES = 5 * 1024;

/** LLM 응답 스키마 — 어긋나면 fallback. */
const LlmResponseSchema = z.object({
  needs_reply: z.boolean(),
  severity: z.enum(["high", "med", "low"]),
  reason: z.string().min(1).max(40),
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

/**
 * LLM 호출 결과 — discriminated union으로 호출자가 분기 명확히 처리.
 *  - "needs-reply": 답장 필요 (severity, reason 포함)
 *  - "no-reply": LLM이 "답장 불필요"로 판정
 *  - "llm-unavailable": LLM 호출 실패 또는 응답 검증 실패 — fallback 사용 권장
 */
export type LlmClassifyResult =
  | { kind: "needs-reply"; output: LlmClassifyOutput }
  | { kind: "no-reply" }
  | { kind: "llm-unavailable"; error: string };

/**
 * 후보 스레드를 LLM이 정밀 검증.
 * 호출자(features/email-analysis)가 결과를 보고 DB에 어떻게 기록할지 결정.
 */
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
    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = extractText(response);
    if (!text) {
      return { kind: "llm-unavailable", error: "LLM 응답 비어있음" };
    }

    const parsed = parseLlmJson(text);
    if (!parsed) {
      return { kind: "llm-unavailable", error: "Zod 검증 실패" };
    }

    if (!parsed.needs_reply) return { kind: "no-reply" };

    return {
      kind: "needs-reply",
      output: {
        severity: parsed.severity,
        reason: parsed.reason,
        classifiedBy: "llm-haiku",
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return { kind: "llm-unavailable", error: message };
  }
}

/**
 * Anthropic 응답에서 텍스트 부분만 추출.
 * SDK의 content는 ContentBlock[] — text 블록만 합침.
 */
function extractText(response: Anthropic.Message): string | null {
  if (!response.content || response.content.length === 0) return null;
  const parts: string[] = [];
  for (const block of response.content) {
    if (block.type === "text") parts.push(block.text);
  }
  return parts.join("").trim() || null;
}

/**
 * 모델이 코드 블록(```json ... ```)으로 감싸거나 앞에 텍스트를 붙여도 파싱.
 */
function parseLlmJson(
  text: string,
): { needs_reply: boolean; severity: "high" | "med" | "low"; reason: string } | null {
  const jsonMatch = text.match(/\{[^{}]*\}/);
  if (!jsonMatch) return null;
  try {
    const obj = JSON.parse(jsonMatch[0]);
    const result = LlmResponseSchema.safeParse(obj);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * UTF-8 바이트 기준 절단 — 한국어 multi-byte 안전.
 * (Buffer가 server-only에서 사용 가능)
 */
function truncateBytes(input: string, maxBytes: number): string {
  const buffer = Buffer.from(input, "utf-8");
  if (buffer.byteLength <= maxBytes) return input;
  // 절단 시 invalid sequence가 생길 수 있어 toString이 알아서 대체.
  return buffer.subarray(0, maxBytes).toString("utf-8") + "…";
}

