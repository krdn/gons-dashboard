// features/email-reply — client-safe entrypoint.
// "use client" 컴포넌트는 이 모듈로만 Server Action을 import.
// (server-only 함수가 같은 barrel에 섞이지 않게 분리 — Gotcha #7)
export { generateReplyDraft } from "./api/generateReplyDraft";
export type {
  GenerateReplyResult,
  ReplyTone,
  ReplyLength,
  ToneDraft,
} from "./api/generateReplyDraft";
export { saveReplyDraft } from "./api/saveReplyDraft";
export type { SaveReplyResult, SaveDraftMeta } from "./api/saveReplyDraft";
