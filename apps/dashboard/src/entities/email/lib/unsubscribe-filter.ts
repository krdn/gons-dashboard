// 메일링 리스트·자동 발송 1차 컷 — LLM에 넘기지 않을 메일.
//
// 정책 (모두 "제외" 신호):
//  1. List-Unsubscribe 헤더 존재
//  2. List-ID 헤더 존재
//  3. Precedence: bulk | list | junk
//  4. From: noreply|no-reply 패턴 AND 본문에 unsubscribe 단어 존재
//
// false negative보다 false positive를 두려워함 — 보안 알림(noreply@accounts.google.com)이
// 컷되면 안 되므로 "noreply 단독"으로는 컷 X. 본문 unsubscribe 단어와 결합될 때만 컷.
import type { MailingListSignals } from "@/shared/api/gmail";

const NOREPLY_PATTERN = /\bno[-_.]?reply@/i;
const UNSUBSCRIBE_PATTERN = /\bunsubscribe\b/i;
const BULK_PRECEDENCE = new Set(["bulk", "list", "junk"]);

export function isMailingList(
  signals: MailingListSignals,
  snippet: string,
): boolean {
  if (signals.hasListUnsubscribe) return true;
  if (signals.hasListId) return true;
  if (signals.precedence !== null && BULK_PRECEDENCE.has(signals.precedence)) {
    return true;
  }
  if (
    signals.fromHeader &&
    NOREPLY_PATTERN.test(signals.fromHeader) &&
    UNSUBSCRIBE_PATTERN.test(snippet)
  ) {
    return true;
  }
  return false;
}
