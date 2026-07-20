import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/shared/lib/db/client";
import { githubIssues, githubWorkflowRuns, githubSyncState } from "@/shared/lib/db/schema";
import {
  replaceIssues,
  replaceRunsForRepo,
  upsertSyncState,
} from "@/entities/github-activity/server";

const ISSUE = {
  id: "krdn/a#1",
  repo: "krdn/a",
  number: 1,
  title: "t",
  url: "u",
  author: "gon",
  labels: ["needs-triage"],
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
};

function makeRun(over: Partial<typeof githubWorkflowRuns.$inferInsert> = {}) {
  return {
    id: "1",
    repo: "krdn/a",
    workflowId: "wf",
    workflowName: "CI",
    status: "completed",
    conclusion: "success",
    headSha: "sha",
    headBranch: "main",
    event: "push",
    runNumber: 1,
    runAttempt: 1,
    url: "u",
    startedAt: new Date(),
    completedAt: new Date(),
    ...over,
  };
}

beforeEach(async () => {
  await db.delete(githubIssues);
  await db.delete(githubWorkflowRuns);
  await db.delete(githubSyncState);
});

describe("replaceIssues", () => {
  it("기존 행을 지우고 새 스냅샷으로 교체한다", async () => {
    await replaceIssues([ISSUE]);
    await replaceIssues([{ ...ISSUE, id: "krdn/a#2", number: 2 }]);
    const rows = await db.select().from(githubIssues);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("krdn/a#2");
  });

  it("빈 배열이면 전부 지운다 (열린 이슈 0건은 정상 상태)", async () => {
    await replaceIssues([ISSUE]);
    await replaceIssues([]);
    expect(await db.select().from(githubIssues)).toHaveLength(0);
  });
});

describe("replaceRunsForRepo", () => {
  // §4.2 규칙 2: Actions 는 레포 단위로 독립 교체된다.
  it("지정한 레포만 교체하고 다른 레포는 건드리지 않는다", async () => {
    await replaceRunsForRepo("krdn/a", [makeRun({ id: "a1", repo: "krdn/a" })]);
    await replaceRunsForRepo("krdn/b", [makeRun({ id: "b1", repo: "krdn/b" })]);
    await replaceRunsForRepo("krdn/a", [makeRun({ id: "a2", repo: "krdn/a" })]);

    const rows = await db.select().from(githubWorkflowRuns);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(["a2", "b1"]);
  });
});

describe("upsertSyncState", () => {
  it("행이 없으면 만들고 있으면 갱신한다", async () => {
    await upsertSyncState("issues", { lastAttemptAt: new Date(), lastError: "boom" });
    await upsertSyncState("issues", { lastSuccessAt: new Date(), lastError: null });

    const rows = await db.select().from(githubSyncState);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lastError).toBeNull();
    expect(rows[0]?.lastSuccessAt).not.toBeNull();
  });

  it("지정하지 않은 필드는 보존한다", async () => {
    const attempt = new Date("2026-07-20T00:00:00Z");
    await upsertSyncState("issues", { lastAttemptAt: attempt });
    await upsertSyncState("issues", { lastError: "x" });

    const rows = await db.select().from(githubSyncState);
    expect(rows[0]?.lastAttemptAt?.toISOString()).toBe(attempt.toISOString());
  });
});
