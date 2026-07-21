// github-monitor-refresh feature — client-safe entrypoint (이슈 #333).
// "use server" 파일 전체가 RPC 경계라, 여기서 server-only syncGithub 을
// import 해도 client bundle 그래프로 끌려오지 않는다 (Gotcha #7 패턴,
// catalog-refresh/client.ts 준용). "use client" 컴포넌트는 이 파일로만 호출한다.
"use server";

import { auth } from "@/shared/lib/auth";
import { logger } from "@/shared/lib/log";
import { syncGithub, type SyncSummary } from "@/features/github-monitor";
import { checkCooldown } from "./lib/rateLimit";
import type { RefreshResult } from "./model/types";

const COOLDOWN_MS = 30_000;

/**
 * 부분 실패한 소스명을 모은다. syncGithub 은 소스별 독립 수행이라 일부만
 * 실패해도 throw 하지 않는다 — ok:false(또는 runs 는 failedRepos 존재)면 실패로 본다.
 * skipped(토큰 미설정)·lockBusy(cron 겹침)는 "안 한 것"이라 별도 필드로 표시하므로 제외.
 */
function collectFailedSources(s: SyncSummary): string[] {
  if (s.skipped) return [];
  const failed: string[] = [];
  if (!s.issues.ok) failed.push("이슈");
  if (!s.pulls.ok) failed.push("PR");
  if (!s.runs.ok || s.runs.failedRepos.length > 0) failed.push("Actions");
  if (!s.build.ok) failed.push("Build");
  return failed;
}

// 전역(사용자 무관) 쿨다운. GitHub API 는 토큰 단위 공유 자원이라 전역이 맞다.
// 단일 인스턴스 가정 — multi-instance 시 Redis 로 이전 필요.
let lastRefreshAt: number | null = null;

export async function refreshGithubMonitor(): Promise<RefreshResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized" };

  const now = Date.now();
  const cd = checkCooldown(lastRefreshAt, now, COOLDOWN_MS);
  if (!cd.allowed) {
    return {
      ok: false,
      error: `잠시 후 다시 시도하세요 (${cd.remainingSec}초 남음)`,
      cooldownSec: cd.remainingSec,
    };
  }
  lastRefreshAt = now;

  try {
    const s = await syncGithub();
    return {
      ok: true,
      summary: {
        issues: s.issues.count,
        pulls: s.pulls.count,
        runs: s.runs.repos,
        skipped: s.skipped,
        lockBusy: s.lockBusy ?? false,
        failed: collectFailedSources(s),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("github-monitor-refresh", "sync-failed", { message });
    return { ok: false, error: message.slice(0, 200) };
  }
}
