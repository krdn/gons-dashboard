// github-monitor-refresh feature — client-safe entrypoint (이슈 #333).
// "use server" 파일 전체가 RPC 경계라, 여기서 server-only syncGithub 을
// import 해도 client bundle 그래프로 끌려오지 않는다 (Gotcha #7 패턴,
// catalog-refresh/client.ts 준용). "use client" 컴포넌트는 이 파일로만 호출한다.
"use server";

import { auth } from "@/shared/lib/auth";
import { logger } from "@/shared/lib/log";
import { syncGithub } from "@/features/github-monitor";
import { checkCooldown } from "./lib/rateLimit";
import type { RefreshResult } from "./model/types";

const COOLDOWN_MS = 30_000;

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
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("github-monitor-refresh", "sync-failed", { message });
    return { ok: false, error: message.slice(0, 200) };
  }
}
