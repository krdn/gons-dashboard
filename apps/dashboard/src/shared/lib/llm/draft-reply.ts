// 답장 초안 생성 LLM 유틸 — classify-thread.ts 패턴 미러.
// 광고/공지/답장 불필요 메일이면 짧은 정중 거절 또는 빈 초안을 생성한다.
import "server-only";
import { z } from "zod";
import { analyzeStructured } from "@krdn/llm-gateway/gateway";
import { HAIKU_MODEL, gatewayDefaults } from "./anthropic";

const MAX_BODY_BYTES = 5 * 1024;

export interface DraftReplyInput {
  fromEmail: string;
  fromName?: string;
  subject: string;
  /** 원본 메일 본문 (mime.ts 추출). 빈 문자열이면 snippet 폴백을 호출자가 넣음. */
  bodyText: string;
  severity: "high" | "med" | "low";
  language: "auto" | "ko" | "en" | "ja" | "zh";
}

const ResponseSchema = z.object({
  body: z.string().min(1).max(2000),
});

export type DraftReplyResult =
  | { kind: "ok"; body: string }
  | { kind: "llm-unavailable"; error: string };

const SYSTEM_PROMPT = `당신은 사용자를 대신해 이메일 답장 초안을 작성합니다.
원본 메일의 맥락(제안/질문/요청)을 읽고 적절한 톤으로 답장을 씁니다.

규칙:
- 받은 메일의 핵심 요청에 직접 응답하는 본문을 작성.
- 메일 성격에 맞는 톤 자동 선택 (정중·간결).
- 광고/공지/마케팅 등 답장이 불필요한 메일이면 짧은 정중한 거절 또는 수신 거부 의사를 1~2문장으로.
- 인사말 + 본문 + 맺음말 구조. 서명은 넣지 않음.
- 응답은 답장 본문 텍스트만. 메타 설명 금지.

JSON: {"body": "답장 본문 전체"}`;

// CLI 정체성 누수 거절 감지 — 발송/저장 차단용 안전망.
// CLI 정체성에 특이적인 문구만 (일반어 "코딩"·"software engineering"은 오탐이라 제외).
const REFUSAL_PATTERNS = [
  "i'm claude code",
  "i am claude code",
  "anthropic's cli",
  "claude code, anthropic",
  "not able to help with composing",
  "i'm not able to help with",
];

export function isRefusalDraft(body: string): boolean {
  const lower = body.toLowerCase();
  return REFUSAL_PATTERNS.some((p) => lower.includes(p));
}

// 답장 언어 지시 — auto는 원본 메일 언어에 맞춤.
export function languageInstruction(
  language: "auto" | "ko" | "en" | "ja" | "zh",
): string {
  switch (language) {
    case "ko":
      return "답장은 반드시 한국어로 작성합니다.";
    case "en":
      return "Write the reply in English.";
    case "ja":
      return "返信は必ず日本語で書いてください。";
    case "zh":
      return "回复必须用中文书写。";
    case "auto":
    default:
      return "답장은 원본 메일과 같은 언어로 작성합니다.";
  }
}

export async function draftReply(
  input: DraftReplyInput,
): Promise<DraftReplyResult> {
  const truncated = truncateBytes(input.bodyText, MAX_BODY_BYTES);

  const userPrompt = [
    `From: ${input.fromName ?? input.fromEmail} <${input.fromEmail}>`,
    `Subject: ${input.subject}`,
    `긴급도: ${input.severity}`,
    "",
    "원본 본문:",
    truncated || "(본문 없음 — 제목 기반으로 작성)",
    "",
    "위 메일에 대한 답장 본문을 JSON으로 작성하세요.",
  ].join("\n");

  const systemPrompt = `${SYSTEM_PROMPT}\n\n${languageInstruction(input.language)}`;

  try {
    const { object } = await analyzeStructured(userPrompt, ResponseSchema, {
      ...gatewayDefaults,
      model: HAIKU_MODEL,
      systemPrompt,
      maxOutputTokens: 1000,
    });
    return { kind: "ok", body: object.body };
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
