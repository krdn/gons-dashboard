// 매일 10:40 KST — SSL 인증서 만료 D-day 점검 (이슈 #323 §F, Phase 2).
// D-14 warning / D-7 critical. TLS 실패 시 unknown (다운은 check-http 담당).
import { createCronHandler } from "@/shared/lib/cron/createCronHandler";
import {
  MONITORED_SITES,
  runSslCheck,
} from "@/features/monitoring-availability";

export const dynamic = "force-dynamic";

export const POST = createCronHandler({
  name: "check-ssl",
  targetSelect: async () => [...MONITORED_SITES],
  getId: (site) => site.domain,
  perTarget: (site) => runSslCheck(site),
  concurrency: 5,
});
