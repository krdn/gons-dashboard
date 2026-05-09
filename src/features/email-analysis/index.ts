// Public API for features/email-analysis
export { classifyThread } from "./api/classifyThread";
export type {
  ClassifyThreadParams,
  ClassifyThreadOutcome,
} from "./api/classifyThread";
export { markAsReplied, unmarkReplied } from "./api/markAsReplied";
export { dismissThread } from "./api/dismissThread";
