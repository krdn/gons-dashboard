// 답장 수신자 형식 검증 — 시스템 경계 입력 검증(coding-style). 순수 함수.
// sendReply/saveReplyDraft 가 createDraft(비가역 발송) 직전 공유 호출.
//
// 의도적 narrowing: bare email 만 허용(display-name "이름 <a@b.com>" 거부).
// 호출부가 extractEmail 로 bare 형태를 pre-fill 하므로 안전하고, Gmail 헤더에
// 들어갈 값을 좁게 통제. CRLF 인젝션은 createDraft 의 sanitizeHeader 가 별도 차단.
import { z } from "zod";

const emailSchema = z.string().email();

export type RecipientField = "to" | "cc" | "bcc";

export type RecipientValidation =
  | { ok: true }
  | { ok: false; field: RecipientField };

interface RecipientInput {
  toEmail: string;
  cc?: string;
  bcc?: string;
}

/** 쉼표 다중 주소를 trim·빈 토큰 필터 후 각각 검증. 빈 입력은 통과(선택 필드). */
function allValid(raw: string | undefined): boolean {
  if (!raw) return true;
  const tokens = raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return tokens.every((t) => emailSchema.safeParse(t).success);
}

export function validateRecipients(input: RecipientInput): RecipientValidation {
  // To 는 필수 단일 주소.
  if (!emailSchema.safeParse(input.toEmail.trim()).success) {
    return { ok: false, field: "to" };
  }
  if (!allValid(input.cc)) return { ok: false, field: "cc" };
  if (!allValid(input.bcc)) return { ok: false, field: "bcc" };
  return { ok: true };
}
