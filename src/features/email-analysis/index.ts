// Public API for features/email-analysis
//
// 분류 핵심 로직(classifyThread)은 entities/email/api로 이동 — features 끼리 의존
// 회피 (FSD boundaries). features/email-analysis는 사용자 액션만 담당.
export { markAsReplied, unmarkReplied } from "./api/markAsReplied";
export { dismissThread } from "./api/dismissThread";
