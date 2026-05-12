// Gmail 헤더에서 메일링 리스트·자동 발송 신호 추출.
// classifyImportant 전 단계의 unsubscribe-filter가 사용.
import "server-only";
import type { GmailHeader } from "./messages";

/** 헤더 이름은 case-insensitive (RFC 5322). */
function getHeader(headers: GmailHeader[] | undefined, name: string): string | null {
  if (!headers) return null;
  const lower = name.toLowerCase();
  for (const h of headers) {
    if (h.name.toLowerCase() === lower) return h.value;
  }
  return null;
}

export interface MailingListSignals {
  hasListUnsubscribe: boolean;
  hasListId: boolean;
  precedence: string | null;
  fromHeader: string | null;
}

export function extractMailingListSignals(
  headers: GmailHeader[] | undefined,
): MailingListSignals {
  const lu = getHeader(headers, "List-Unsubscribe");
  const lid = getHeader(headers, "List-ID");
  const prec = getHeader(headers, "Precedence");
  const from = getHeader(headers, "From");
  return {
    hasListUnsubscribe: lu !== null && lu.trim().length > 0,
    hasListId: lid !== null && lid.trim().length > 0,
    precedence: prec?.trim().toLowerCase() ?? null,
    fromHeader: from,
  };
}
