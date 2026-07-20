// GitHub 관제 DB 쓰기 — 스냅샷 교체 (이슈 #323 §4.2).
//
// ⚠️ 호출자는 원격 응답을 **완전히 수집한 뒤에만** 이 함수들을 부른다.
// 페이지 도중 실패한 부분 결과로 교체하면 멀쩡한 행이 사라진다.
// 교체는 DELETE+INSERT 를 단일 트랜잭션으로 묶어 중간 상태가 보이지 않게 한다.
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  githubIssues,
  githubPullRequests,
  githubWorkflowRuns,
  githubSyncState,
} from "@/shared/lib/db/schema";
import { type SyncSource } from "../model/types";

type NewIssue = typeof githubIssues.$inferInsert;
type NewPr = typeof githubPullRequests.$inferInsert;
type NewRun = typeof githubWorkflowRuns.$inferInsert;
type SyncPatch = Partial<Omit<typeof githubSyncState.$inferInsert, "source">>;

export async function replaceIssues(rows: NewIssue[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(githubIssues);
    if (rows.length > 0) await tx.insert(githubIssues).values(rows);
  });
}

export async function replacePrs(rows: NewPr[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(githubPullRequests);
    if (rows.length > 0) await tx.insert(githubPullRequests).values(rows);
  });
}

/**
 * 레포 단위 교체 — 한 레포의 Actions 조회가 실패해도 그 레포의 이전 run 만
 * 유지되고 나머지는 갱신되도록 호출자가 레포별로 부른다.
 */
export async function replaceRunsForRepo(repo: string, rows: NewRun[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(githubWorkflowRuns).where(eq(githubWorkflowRuns.repo, repo));
    if (rows.length > 0) await tx.insert(githubWorkflowRuns).values(rows);
  });
}

/**
 * 부분 갱신 — 지정한 필드만 덮어쓰고 나머지는 보존한다.
 * lastError 를 명시적으로 null 로 넘기면 지워진다(전체 성공 시).
 */
export async function upsertSyncState(source: SyncSource, patch: SyncPatch): Promise<void> {
  await db
    .insert(githubSyncState)
    .values({ source, ...patch })
    .onConflictDoUpdate({ target: githubSyncState.source, set: patch });
}
