// features/email-reply — server entrypoint.
// Server Action들은 client.ts로도 노출 (client 컴포넌트 import용).
import "server-only";

export { generateReplyDraft } from "./api/generateReplyDraft";
export type {
  GenerateReplyResult,
  ReplyTone,
  ReplyLength,
  ToneDraft,
} from "./api/generateReplyDraft";
export { saveReplyDraft } from "./api/saveReplyDraft";
export type { SaveReplyResult, SaveDraftMeta } from "./api/saveReplyDraft";
export { sendReply } from "./api/sendReply";
export type { SendReplyResult } from "./api/sendReply";
