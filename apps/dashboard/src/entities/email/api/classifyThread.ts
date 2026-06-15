// 스레드 분류 핵심 로직 — entities/email
//
// 이 파일은 features/gmail-sync (cron syncInbox)와 features/email-analysis 양쪽이 호출.
// 그래서 entities 레이어에 두는 게 FSD 정통 (features → features 의존 회피).
//
// CRITICAL §3 #7: 멱등성 (재호출 시 중복 X) — PRIMARY KEY(thread_id) ON CONFLICT.
// user_action='replied' 행은 절대 덮어쓰지 않음 (사용자 결정 보호).
import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { replyNeeded } from "@/shared/lib/db/schema";
import {
  classifyDeterministic,
  DETERMINISTIC_VERSION,
} from "../lib/deterministic-classifier";
import type { ThreadInput, ClassificationResult } from "../model/types";
import {
  classifyWithLLM,
  LLM_CLASSIFIER_VERSION,
  type LlmClassifyInput,
} from "@/shared/lib/llm/classify-thread";

export interface ClassifyThreadParams {
  userId: string;
  threadId: string;
  input: ThreadInput;
  /** false면 LLM 호출 생략, deterministic 결과만 사용(설정 llmReplyEnabled=false). 기본 true. */
  useLlm?: boolean;
}

export type ClassifyThreadOutcome =
  | { kind: "skipped-deterministic" }
  | { kind: "skipped-llm-no-reply" }
  | { kind: "classified"; result: ClassificationResult }
  | { kind: "user-replied" }
  | { kind: "fallback"; result: ClassificationResult; reason: string };

export async function classifyThread(
  params: ClassifyThreadParams,
): Promise<ClassifyThreadOutcome> {
  const { userId, threadId, input } = params;

  // 사용자가 "답장함" 처리한 행은 건드리지 않음.
  const existing = await db
    .select({ userAction: replyNeeded.userAction })
    .from(replyNeeded)
    .where(eq(replyNeeded.threadId, threadId))
    .limit(1);
  if (existing[0]?.userAction === "replied") {
    return { kind: "user-replied" };
  }

  // 1. Deterministic 1차 필터.
  const detResult = classifyDeterministic(input);
  if (!detResult) {
    await db.delete(replyNeeded).where(eq(replyNeeded.threadId, threadId));
    return { kind: "skipped-deterministic" };
  }

  // 2. LLM 정밀 분류.
  const llmInput: LlmClassifyInput = {
    fromEmail: input.lastSenderEmail,
    fromName: input.lastSenderName,
    subject: input.subject,
    snippet: input.snippet,
  };
  const useLlm = params.useLlm ?? true;
  // useLlm=false면 LLM 호출 생략 — 기존 llm-unavailable 경로(deterministic fallback)로 라우팅.
  const llmResult = useLlm
    ? await classifyWithLLM(llmInput)
    : ({ kind: "llm-unavailable", error: "llm-disabled-by-settings" } as const);

  if (llmResult.kind === "no-reply") {
    await db.delete(replyNeeded).where(eq(replyNeeded.threadId, threadId));
    return { kind: "skipped-llm-no-reply" };
  }

  let finalResult: ClassificationResult;
  let classifierVersion: string;
  let outcomeKind: "classified" | "fallback";
  let fallbackReason = "";

  if (llmResult.kind === "needs-reply") {
    finalResult = {
      severity: llmResult.output.severity,
      reason: llmResult.output.reason,
      classifiedBy: llmResult.output.classifiedBy,
    };
    classifierVersion = LLM_CLASSIFIER_VERSION;
    outcomeKind = "classified";
  } else {
    finalResult = detResult;
    classifierVersion = DETERMINISTIC_VERSION;
    outcomeKind = "fallback";
    fallbackReason = llmResult.error;
  }

  // 3. DB upsert (멱등).
  await db
    .insert(replyNeeded)
    .values({
      threadId,
      userId,
      reason: finalResult.reason,
      severity: finalResult.severity,
      classifiedBy: finalResult.classifiedBy,
      classifierVersion,
      classifiedAt: new Date(),
      userAction: "none",
    })
    .onConflictDoUpdate({
      target: replyNeeded.threadId,
      set: {
        reason: finalResult.reason,
        severity: finalResult.severity,
        classifiedBy: finalResult.classifiedBy,
        classifierVersion,
        classifiedAt: new Date(),
      },
      setWhere: sql`${replyNeeded.userAction} <> 'replied'`,
    });

  if (outcomeKind === "fallback") {
    return { kind: "fallback", result: finalResult, reason: fallbackReason };
  }
  return { kind: "classified", result: finalResult };
}
