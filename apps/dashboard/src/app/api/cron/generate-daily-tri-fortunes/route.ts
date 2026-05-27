// 매일 자정+5분 KST — 활성 프로필 전원의 오늘 tri 일진(4학파) frame 만 일괄 생성.
//
// 셰이프: createCronHandler factory 위임 (`generate-daily-fortunes` 와 같은 패턴).
//
// v0.3.x — narrative 는 widget lazy fetch 로 이전 (monthly cron 미러). cron 은
// frame 만 prefill 해 위젯 첫 진입 지연을 줄이고, narrative LLM 호출은 실제 본
// 사용자만 발생시켜 비용을 줄인다.
//
// spec §4 위험 대응:
//  - target concurrency=2 — frame 빌더는 동기 계산이지만 동시성은 모니터링 차원 유지
//
// per-target 실패 격리:
//  - frame build 실패 → createCronHandler 가 results[].status='error' 격리
//
// CRITICAL: KST 자정 정확 트리거 — 호출자(node-cron 컨테이너)가
//   timezone: 'Asia/Seoul', cron expression: '5 0 * * *' (generate-daily-fortunes 와 5분 stagger).
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { fortuneProfiles } from "@/shared/lib/db/schema";
import { createCronHandler } from "@/shared/lib/cron/createCronHandler";
import { getOrBuildDaily } from "@/features/saju-daily-tri/api/daily-server";
import { currentKstDate } from "@/shared/lib/saju/resolveBirthInput";
import type { TriNationDailyLite } from "@krdn/saju";

export const dynamic = "force-dynamic";

interface Target {
  profileId: string;
  userId: string;
  name: string;
}

interface Payload {
  overallVibe: TriNationDailyLite["overallVibe"];
  frameCached: boolean;
}

export const POST = createCronHandler({
  name: "generate-daily-tri-fortunes",
  targetSelect: async (): Promise<Target[]> =>
    db
      .select({
        profileId: fortuneProfiles.id,
        userId: fortuneProfiles.userId,
        name: fortuneProfiles.name,
      })
      .from(fortuneProfiles)
      .where(eq(fortuneProfiles.isActive, true)),
  getId: (t) => t.profileId,
  getLabel: (t) => t.name,
  perTarget: async (t): Promise<Payload> => {
    const forDate = currentKstDate();
    const dailyResult = await getOrBuildDaily(t.profileId, t.userId, forDate);
    return {
      overallVibe: dailyResult.triNation.overallVibe,
      frameCached: dailyResult.fromCache,
    };
  },
  concurrency: 2,
  extra: async () => ({ forDate: currentKstDate() }),
});
