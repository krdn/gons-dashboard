// 5분마다 — GitHub 이슈·PR·Actions 스냅샷 동기화 (이슈 #323).
// 수집 잡이므로 놓친 주기는 다음 5분이 대체한다 — catchup·retry 없음.
import { createCronHandler } from "@/shared/lib/cron/createCronHandler";
import { syncGithub, type SyncSummary } from "@/features/github-monitor";

export const dynamic = "force-dynamic";

// 단일 대상 cron — 소스별 격리는 syncGithub 내부가 담당한다.
const TARGETS = [{ id: "github" }] as const;

/** 실패한 소스 이름 목록. 비어 있으면 전 소스 성공. */
function failedSources(summary: SyncSummary): string[] {
  const failed: string[] = [];
  if (!summary.issues.ok) failed.push("issues");
  if (!summary.pulls.ok) failed.push("pulls");
  if (!summary.runs.ok) failed.push("runs");
  if (!summary.build.ok) failed.push("build");
  return failed;
}

export const POST = createCronHandler({
  name: "github-sync",
  targetSelect: async () => [...TARGETS],
  getId: (t) => t.id,
  perTarget: async () => {
    const summary = await syncGithub();

    // ⚠️ createCronHandler 는 perTarget 이 throw 해야 cron_runs 를 실패로
    // 기록한다. summary 를 그대로 반환하면 전 소스가 실패해도 status=ok 로
    // 남아 관제의 수집기 자체가 관측 불가가 된다.
    //
    // 토큰 미설정(skipped)은 실패가 아니다 — 의도적 비활성이므로 ok 로 둔다.
    if (!summary.skipped) {
      const failed = failedSources(summary);
      if (failed.length > 0) {
        throw new Error(`GitHub 동기화 부분 실패: ${failed.join(", ")}`);
      }
    }

    return summary as unknown as Record<string, unknown>;
  },
});
