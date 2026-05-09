// 스레드 분류 — deterministic + LLM 정밀 분류 + DB write.
// eng review CRITICAL §3 #7: 멱등성 (재호출 시 중복 X).
//
// 흐름:
//  1. classifyDeterministic(input) — null이면 분류 종료 (LLM 호출 X)
//  2. classifyWithLLM(input) — 결과 따라 분기:
//      - needs-reply → DB upsert (entities/email schema의 reply_needed)
//      - no-reply → DB에서 기존 행 제거 (재분류로 결과 바뀐 경우)
//      - llm-unavailable → deterministic 결과로 fallback upsert
//  3. user_action == 'replied' 행은 절대 덮어쓰지 않음 (사용자 결정 보호)
"use server";

import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { replyNeeded } from "@/shared/lib/db/schema";
import {
  classifyDeterministic,
  DETERMINISTIC_VERSION,
  type ThreadInput,
  type ClassificationResult,
} from "@/entities/email";
import {
  classifyWithLLM,
  LLM_CLASSIFIER_VERSION,
  type LlmClassifyInput,
  type LlmClassifyResult,
} from "@/shared/lib/llm/classify-thread";

export interface ClassifyThreadParams {
  userId: string;
  threadId: string; // DB 의 email_threads.id (uuid)
  input: ThreadInput;
}

export type ClassifyThreadOutcome =
  | { kind: "skipped-deterministic" }
  | { kind: "skipped-llm-no-reply" }
  | { kind: "classified"; result: ClassificationResult }
  | { kind: "user-replied" } // 사용자가 이미 답장 처리 — 건드리지 않음
  | { kind: "fallback"; result: ClassificationResult; reason: string };

/**
 * 메일 스레드 1개를 분류 + DB write.
 * 호출자: features/gmail-sync의 syncInbox가 새 메시지 도착 시 트리거.
 *
 * 멱등성:
 *  - reply_needed PRIMARY KEY(thread_id) → ON CONFLICT DO UPDATE
 *  - user_action='replied'면 무시 (사용자 결정 보호)
 */
export async function classifyThread(
  params: ClassifyThreadParams,
): Promise<ClassifyThreadOutcome> {
  const { userId, threadId, input } = params;

  // 사용자가 이미 "답장함" 처리한 행은 건드리지 않음.
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
    // 후보 아님 — DB에 기존 행 있으면 제거 (재분류로 false로 바뀐 경우).
    await db.delete(replyNeeded).where(eq(replyNeeded.threadId, threadId));
    return { kind: "skipped-deterministic" };
  }

  // 2. LLM 정밀 분류 (deterministic이 후보로 분류한 것만).
  const llmInput: LlmClassifyInput = {
    fromEmail: input.lastSenderEmail,
    fromName: input.lastSenderName,
    subject: input.subject,
    snippet: input.snippet,
  };
  const llmResult: LlmClassifyResult = await classifyWithLLM(llmInput);

  // 3. 결과 분기.
  if (llmResult.kind === "no-reply") {
    // LLM이 "답장 불필요"로 판정 → 기존 행 제거.
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
    // llm-unavailable → deterministic 결과로 fallback (graceful degrade).
    finalResult = detResult;
    classifierVersion = DETERMINISTIC_VERSION;
    outcomeKind = "fallback";
    fallbackReason = llmResult.error;
  }

  // 4. DB upsert (멱등). PRIMARY KEY 는 thread_id.
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
        // 사용자 액션이 진행 중이면 분류 결과만 갱신, 액션은 보존.
      },
      // user_action='replied' 보호는 위에서 이미 했으므로 여기선 안전.
      setWhere: sql`${replyNeeded.userAction} <> 'replied'`,
    });

  if (outcomeKind === "fallback") {
    return { kind: "fallback", result: finalResult, reason: fallbackReason };
  }
  return { kind: "classified", result: finalResult };
}
