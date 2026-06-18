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

/** email_threads 행에 영속화된 신호 컬럼. NULL = 미채집(마이그레이션 이전/헤더 누락). */
export interface PersistedSignalRow {
  hasListUnsubscribe: boolean | null;
  hasListId: boolean | null;
  precedence: string | null;
  fromHeader: string | null;
}

/** 신호 컬럼이 한 번도 채집되지 않은(전부 NULL) 행인지. reclassify가 lazy 재채집할지 판정. */
export function isSignalRowUnpopulated(row: PersistedSignalRow): boolean {
  return (
    row.hasListUnsubscribe === null &&
    row.hasListId === null &&
    row.precedence === null
  );
}

/**
 * DB 영속화 신호 행 → MailingListSignals.
 * 순수 함수(DB·fetch 무관) — 단위 테스트 가능한 seam.
 * NULL boolean은 false로 좁힘(미채집 = 신호 없음으로 안전 측 처리).
 */
export function rowToSignals(row: PersistedSignalRow): MailingListSignals {
  return {
    hasListUnsubscribe: row.hasListUnsubscribe === true,
    hasListId: row.hasListId === true,
    precedence: row.precedence,
    fromHeader: row.fromHeader,
  };
}
