// 수동 재분류 — 검증/복구용.
//
// syncInbox는 Gmail history.list 결과 새 메시지가 0개면 분류 분기 자체를 skip한다
// (last_history_id 보전 멱등성). 그 결과 모델 업그레이드/프롬프트 변경 등의
// 재분류 시나리오에서 hourly cron만 기다리면 자연 검증이 안 되는 사각이 생긴다.
//
// 이 함수는:
//   - last_history_id를 건드리지 않고 (Gmail 동기화는 분리)
//   - hoursBack 윈도우 안의 user 스레드에 대해
//   - force=true면 important_emails(해당 user×윈도우)를 먼저 비우고
//   - classifyThreadsLoop로 reply_needed + important 1사이클 재실행한다.
//
// 보안: 라우트 레이어에서 인증, 본 함수는 userId 신뢰. ownerEmail은 users 테이블에서 lookup.
import "server-only";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  users,
  emailThreads,
  importantEmails,
} from "@/shared/lib/db/schema";
import { logger } from "@/shared/lib/log";
import { classifyThreadsLoop } from "../lib/classifyThreadsLoop";

export interface ReclassifyRecentParams {
  userId: string;
  hoursBack: number;
  force: boolean;
}

export interface ReclassifyRecentResult {
  kind: "ok" | "user-not-found";
  email?: string;
  windowFrom?: string;
  threadsInWindow?: number;
  forcedDeleted?: number;
  classified?: number;
  skipped?: number;
  importantOutcomes?: Record<string, number>;
  importantConsidered?: number;
}

const MAX_THREADS = 500;

export async function reclassifyRecent(
  params: ReclassifyRecentParams,
): Promise<ReclassifyRecentResult> {
  const { userId, hoursBack, force } = params;

  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return { kind: "user-not-found" };

  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

  const windowThreads = await db
    .select({ id: emailThreads.id })
    .from(emailThreads)
    .where(
      and(
        eq(emailThreads.userId, userId),
        gte(emailThreads.lastReceivedAt, since),
      ),
    )
    .limit(MAX_THREADS);

  let forcedDeleted = 0;
  if (force && windowThreads.length > 0) {
    const ids = windowThreads.map((t) => t.id);
    const deleted = await db
      .delete(importantEmails)
      .where(
        and(
          eq(importantEmails.userId, userId),
          inArray(importantEmails.threadId, ids),
        ),
      )
      .returning({ threadId: importantEmails.threadId });
    forcedDeleted = deleted.length;
  }

  const result = await classifyThreadsLoop({
    userId,
    ownerEmail: user.email,
    since,
    maxThreads: MAX_THREADS,
  });

  // 재분류는 본질적으로 진단/검증 — 항상 outcome 분포 로깅.
  logger.info("reclassifyRecent", "outcomes", {
    userId,
    email: user.email,
    hoursBack,
    force,
    forcedDeleted,
    threadsInWindow: windowThreads.length,
    importantOutcomes: result.importantOutcomes,
  });

  return {
    kind: "ok",
    email: user.email,
    windowFrom: since.toISOString(),
    threadsInWindow: windowThreads.length,
    forcedDeleted,
    classified: result.classified,
    skipped: result.skipped,
    importantOutcomes: result.importantOutcomes,
    importantConsidered: result.importantConsidered,
  };
}
