// GitHub 관제 DB 쓰기 — 스냅샷 교체 (이슈 #323 §4.2).
//
// ⚠️ 호출자는 원격 응답을 **완전히 수집한 뒤에만** 이 함수들을 부른다.
// 페이지 도중 실패한 부분 결과로 교체하면 멀쩡한 행이 사라진다.
// 교체는 DELETE+INSERT 를 단일 트랜잭션으로 묶어 중간 상태가 보이지 않게 한다.
import "server-only";
import { eq, notInArray } from "drizzle-orm";
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
 * 대상 목록 밖 레포의 run 을 삭제한다 (reconciliation).
 *
 * 왜 필요한가: syncRuns 는 활성 레포(최근 7일 push)만 순회하고
 * replaceRunsForRepo 는 인자로 받은 레포만 지운다. 그래서 어제까지 활성이던
 * 레포가 오늘 cutoff 밖으로 밀려나면 그 run 이 갱신도 삭제도 되지 않고
 * 영구히 남아, 보드의 "Actions 실패" 카운트에 유령 실패로 계속 잡힌다.
 *
 * ⚠️ keepRepos 에는 **조회에 실패한 활성 레포도 포함**해야 한다. 실패를
 * 이유로 지우면 §4.2 의 "부분 실패 시 이전 스냅샷 유지" 계약이 깨진다.
 *
 * keepRepos 가 비면 아무것도 지우지 않는다 — 레포 목록 조회 자체가 실패한
 * 상황에서 전체 삭제가 일어나는 것을 막는다.
 */
export async function pruneRunsNotIn(keepRepos: string[]): Promise<number> {
  if (keepRepos.length === 0) return 0;
  const res = await db
    .delete(githubWorkflowRuns)
    .where(notInArray(githubWorkflowRuns.repo, keepRepos));
  return res.count;
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
