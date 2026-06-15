// 단일 스레드 → 중요 분류 + DB upsert. cron syncInbox에서 호출.
//
// 멱등: 같은 threadId가 이미 분류돼 있고, last_received_at <= classified_at이면 skip.
// 새 메시지로 last_received_at가 갱신된 경우만 재분류.
//
// API 실패는 catch해서 outcome으로 변환 — 호출자(syncInbox)가 한 스레드 실패로 사이클 멈추면 안 됨.
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { importantEmails, emailThreads } from "@/shared/lib/db/schema";
import { classifyImportantWithLlm } from "@/shared/lib/llm/classify-important";
import { logger } from "@/shared/lib/log";
import { isMailingList } from "../lib/unsubscribe-filter";
import type {
  ImportantInput,
  Category,
  ImportantImportance,
} from "../model/types";
import type { MailingListSignals } from "@/shared/api/gmail";

export type ImportantOutcome =
  | {
      kind: "classified";
      category: Category;
      importance: ImportantImportance;
    }
  | { kind: "skipped-mailing-list" }
  | { kind: "skipped-already" }
  | { kind: "skipped-none" }
  | { kind: "skipped-llm-error" };

export interface ClassifyImportantParams {
  userId: string;
  threadId: string;
  input: ImportantInput;
  signals: MailingListSignals;
  /** false면 important LLM 분류 생략(설정 llmImportantEnabled=false). 기본 true. */
  useLlm?: boolean;
}

export async function classifyImportantThread(
  params: ClassifyImportantParams,
): Promise<ImportantOutcome> {
  const { userId, threadId, input, signals } = params;

  // 1. 메일링 컷.
  if (isMailingList(signals, input.snippet)) {
    return { kind: "skipped-mailing-list" };
  }

  // 2. 이미 분류된 행 + 새 메시지 없음 → skip.
  const [thread] = await db
    .select({ lastReceivedAt: emailThreads.lastReceivedAt })
    .from(emailThreads)
    .where(eq(emailThreads.id, threadId))
    .limit(1);
  if (!thread) return { kind: "skipped-already" };

  const [existing] = await db
    .select({ classifiedAt: importantEmails.classifiedAt })
    .from(importantEmails)
    .where(eq(importantEmails.threadId, threadId))
    .limit(1);
  if (existing) {
    const lastReceived = thread.lastReceivedAt;
    if (!lastReceived || lastReceived <= existing.classifiedAt) {
      return { kind: "skipped-already" };
    }
  }

  // 3. LLM 분류. important는 LLM 전용 — 끄면 기존 skipped-llm-error kind로 skip.
  const useLlm = params.useLlm ?? true;
  if (!useLlm) {
    return { kind: "skipped-llm-error" };
  }

  let result: Awaited<ReturnType<typeof classifyImportantWithLlm>>;
  try {
    result = await classifyImportantWithLlm(input);
  } catch (err) {
    logger.warn("classify-important", "llm-error", {
      threadId,
      message: err instanceof Error ? err.message : String(err),
    });
    return { kind: "skipped-llm-error" };
  }
  if (!result) return { kind: "skipped-none" };

  // 4. DB upsert (멱등). PK 충돌 시 분류 결과 갱신, read_at·archived_at은 보존.
  await db
    .insert(importantEmails)
    .values({
      threadId,
      userId,
      category: result.category,
      importance: result.importance,
      summary: result.summary,
      rationale: result.rationale,
      classifierVersion: result.classifierVersion,
      classifiedBy: result.classifiedBy,
      classifiedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: importantEmails.threadId,
      set: {
        category: result.category,
        importance: result.importance,
        summary: result.summary,
        rationale: result.rationale,
        classifierVersion: result.classifierVersion,
        classifiedBy: result.classifiedBy,
        classifiedAt: new Date(),
      },
    });

  return {
    kind: "classified",
    category: result.category,
    importance: result.importance,
  };
}
