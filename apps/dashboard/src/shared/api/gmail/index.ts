// Gmail API 클라이언트 — public API.
// 외부 (features/gmail-sync, features/email-analysis 등)는 이 index만 import.
export { getValidAccessToken } from "./auth";
export type { GmailAccessToken } from "./auth";
export { getGmailTokenOrResult } from "./tokenResult";
export type { GmailTokenResult } from "./tokenResult";
export {
  listHistorySince,
  getCurrentHistoryId,
} from "./history";
export type { HistoryListResult } from "./history";
export { listMessages, getMessage, findHeader } from "./messages";
export type { MessageRef, MessageDetail, GmailHeader } from "./messages";
export {
  GmailError,
  InvalidGrantError,
  HistoryStaleError,
  GmailRateLimitError,
  GmailServerError,
  GmailClientError,
  GmailScopeError,
  isRetryable,
} from "./errors";
export { extractMailingListSignals } from "./headers";
export type { MailingListSignals } from "./headers";
export { modifyThread } from "./modify";
export type { ModifyOptions, ModifyResponse } from "./modify";
export { getThread } from "./threads";
export type { GmailThread, ThreadMessage } from "./threads";
export { extractBodyText } from "./mime";
export type { GmailPayload } from "./mime";
export { createDraft, buildRfc822 } from "./drafts";
export type { DraftParams, CreateDraftResult } from "./drafts";
export { sendDraft } from "./send";
export type { SendDraftResult } from "./send";
