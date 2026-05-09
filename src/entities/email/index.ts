// Public API for entities/email
// FSD: 외부에서는 이 index를 통해서만 import.
export type {
  Severity,
  ClassifiedBy,
  UserAction,
  OAuthState,
  ThreadInput,
  ClassificationResult,
} from "./model/types";
export {
  classifyDeterministic,
  DETERMINISTIC_VERSION,
} from "./lib/deterministic-classifier";
export { getReplyNeeded } from "./api/getReplyNeeded";
export type { ReplyNeededItem } from "./api/getReplyNeeded";
export { classifyThread } from "./api/classifyThread";
export type {
  ClassifyThreadParams,
  ClassifyThreadOutcome,
} from "./api/classifyThread";
export { classifyImportantThread } from "./api/classifyImportant";
export type {
  ImportantOutcome,
  ClassifyImportantParams,
} from "./api/classifyImportant";
