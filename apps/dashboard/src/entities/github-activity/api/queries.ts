// GitHub 관제 DB 조회 — RSC 가 읽는 유일한 경로 (이슈 #323).
import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  githubIssues,
  githubPullRequests,
  githubWorkflowRuns,
  githubSyncState,
} from "@/shared/lib/db/schema";
import {
  type GithubIssue,
  type GithubPullRequest,
  type GithubWorkflowRun,
  type GithubSyncState,
  type BuildState,
  type SyncSource,
} from "../model/types";

export async function listOpenIssues(): Promise<GithubIssue[]> {
  const rows = await db.select().from(githubIssues).orderBy(desc(githubIssues.updatedAt));
  return rows.map((r) => ({
    id: r.id,
    repo: r.repo,
    number: r.number,
    title: r.title,
    url: r.url,
    author: r.author,
    labels: r.labels,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function listOpenPrs(): Promise<GithubPullRequest[]> {
  const rows = await db
    .select()
    .from(githubPullRequests)
    .orderBy(githubPullRequests.createdAt);
  return rows.map((r) => ({
    id: r.id,
    repo: r.repo,
    number: r.number,
    title: r.title,
    url: r.url,
    author: r.author,
    isDraft: r.isDraft,
    headSha: r.headSha,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

function toRun(r: typeof githubWorkflowRuns.$inferSelect): GithubWorkflowRun {
  return {
    id: r.id,
    repo: r.repo,
    workflowId: r.workflowId,
    workflowName: r.workflowName,
    status: r.status,
    conclusion: r.conclusion,
    headSha: r.headSha,
    headBranch: r.headBranch,
    event: r.event,
    runNumber: r.runNumber,
    runAttempt: r.runAttempt,
    url: r.url,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
  };
}

export async function listRecentRuns(): Promise<GithubWorkflowRun[]> {
  const rows = await db
    .select()
    .from(githubWorkflowRuns)
    .orderBy(desc(githubWorkflowRuns.startedAt));
  return rows.map(toRun);
}

export async function getSyncStates(): Promise<GithubSyncState[]> {
  const rows = await db.select().from(githubSyncState);
  return rows.map((r) => ({
    source: r.source as SyncSource,
    lastAttemptAt: r.lastAttemptAt,
    lastSuccessAt: r.lastSuccessAt,
    lastError: r.lastError,
    totalCount: r.totalCount,
    truncated: r.truncated,
    buildState: r.buildState as BuildState | null,
    mainHeadSha: r.mainHeadSha,
    mainHeadCommittedAt: r.mainHeadCommittedAt,
    buildRunUrl: r.buildRunUrl,
    buildConclusion: r.buildConclusion,
  }));
}

export async function getBuildState(): Promise<GithubSyncState | null> {
  const rows = await db
    .select()
    .from(githubSyncState)
    .where(eq(githubSyncState.source, "build"))
    .limit(1);
  const r = rows[0];
  if (r == null) return null;
  return {
    source: "build",
    lastAttemptAt: r.lastAttemptAt,
    lastSuccessAt: r.lastSuccessAt,
    lastError: r.lastError,
    totalCount: r.totalCount,
    truncated: r.truncated,
    buildState: r.buildState as BuildState | null,
    mainHeadSha: r.mainHeadSha,
    mainHeadCommittedAt: r.mainHeadCommittedAt,
    buildRunUrl: r.buildRunUrl,
    buildConclusion: r.buildConclusion,
  };
}
