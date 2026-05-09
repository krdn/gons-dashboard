// Email 도메인 타입 — entities/email
// FSD: features와 widgets가 이 타입을 import. 다른 entities는 import X.

export type Severity = "high" | "med" | "low";
export type ClassifiedBy = "deterministic" | "llm-haiku";
export type UserAction = "replied" | "dismissed" | "none";
export type OAuthState = "active" | "reauth_required";

/**
 * 분류기 입력 — 단일 스레드의 마지막 메시지 메타데이터.
 * deterministic-classifier와 llm-classifier 둘 다 이 형태를 받는다.
 */
export interface ThreadInput {
  threadId: string;
  /** 메시지 헤더 From의 이메일 부분 (소문자 정규화). */
  lastSenderEmail: string;
  lastSenderName?: string;
  subject: string;
  /** Gmail snippet — 본문의 처음 200자 정도. */
  snippet: string;
  /** 메시지 받은 시각 (KST 변환은 호출자 책임). */
  receivedAt: Date;
  /** 사용자 본인 이메일 (allowlist의 첫 항목). */
  ownerEmail: string;
  /** 본인이 같은 스레드에 답장한 적이 있는지. polling 시 lastSender로 판단. */
  lastSenderIsOwner: boolean;
}

/**
 * 분류 결과 — DB의 reply_needed 행으로 변환.
 * null 반환은 "답장 불필요"를 의미.
 */
export interface ClassificationResult {
  severity: Severity;
  /** UI 뱃지로 표시될 1줄 사유. */
  reason: string;
  classifiedBy: ClassifiedBy;
}
