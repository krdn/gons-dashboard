// 매분 — nginx 사이트 synthetic HTTP 체크 (이슈 #323 §E, Phase 2).
// 단발 실패는 row 만, 3연속 실패 시 critical 이벤트 — 판정은 feature 내부.
import { createCronHandler } from "@/shared/lib/cron/createCronHandler";
import {
  MONITORED_SITES,
  runHttpCheck,
} from "@/features/monitoring-availability";

export const dynamic = "force-dynamic";

export const POST = createCronHandler({
  name: "check-http",
  targetSelect: async () => [...MONITORED_SITES],
  getId: (site) => site.domain,
  perTarget: (site) => runHttpCheck(site),
  // 10사이트 × 타임아웃 10s — 직렬이면 최악 100s 로 매분 주기를 넘는다.
  concurrency: 5,
});
