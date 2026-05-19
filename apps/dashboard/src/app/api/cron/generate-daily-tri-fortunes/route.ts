// 매일 자정+5분 KST — 활성 프로필 전원의 오늘 tri 일진(4학파) 을 일괄 생성.
//
// 셰이프: createCronHandler factory 위임 (`generate-daily-fortunes` 와 같은 패턴).
//
// spec §4 위험 대응:
//  - target concurrency=2 — LLM rate limit / 비용 burst 회피 (generate-daily-fortunes 와 동일)
//  - per-target: 4학파 narrative 를 Promise.allSettled 로 병렬 처리 — 4배 비용을 시간으로 흡수
//  - 동시 LLM 호출 max 8 (2 profiles × 4 schools).
//  - per-school 실패 격리: Promise.allSettled 로 일부 학파 실패해도 다른 학파 narrative 저장
//
// per-target 실패 격리:
//  - frame build 실패 → createCronHandler 가 results[].status='error' 격리
//  - 일부 학파 narrative 실패 → narrativesFailed 카운트 증가, frame 자체는 정상 저장
//
// CRITICAL: KST 자정 정확 트리거 — 호출자(node-cron 컨테이너)가
//   timezone: 'Asia/Seoul', cron expression: '5 0 * * *' (generate-daily-fortunes 와 5분 stagger).
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { fortuneProfiles } from "@/shared/lib/db/schema";
import { createCronHandler } from "@/shared/lib/cron/createCronHandler";
import {
  getOrBuildDaily,
  kstTodayDate,
} from "@/features/saju-daily-tri/api/daily-server";
import {
  getOrBuildDailyNarrative,
  type NarrativeSchool,
} from "@/features/saju-daily-tri/api/narrative-server";
import type { TriNationDailyLite } from "@gons/saju";

export const dynamic = "force-dynamic";

interface Target {
  profileId: string;
  userId: string;
  name: string;
}

interface Payload {
  overallVibe: TriNationDailyLite["overallVibe"];
  frameCached: boolean;
  narrativesGenerated: number;
  narrativesFailed: number;
  failedSchools: NarrativeSchool[];
}

const SCHOOL_FRAME_KEY: Record<NarrativeSchool, keyof TriNationDailyLite["frames"]> = {
  ko: "ko",
  "cn-ziping": "cnZiping",
  "cn-mangpai": "cnMangpai",
  jp: "jp",
};
const SCHOOLS: NarrativeSchool[] = ["ko", "cn-ziping", "cn-mangpai", "jp"];

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
    const forDate = kstTodayDate();

    // 1) frame (4학파 결정형 분석) — sync, 빠름. 실패 시 throw → createCronHandler 가 격리.
    const dailyResult = await getOrBuildDaily(t.profileId, t.userId, forDate);

    // 2) 4학파 narrative 병렬 — Promise.allSettled 로 일부 실패 격리.
    const settled = await Promise.allSettled(
      SCHOOLS.map((school) =>
        getOrBuildDailyNarrative(
          t.profileId,
          school,
          forDate,
          dailyResult.triNation.frames[SCHOOL_FRAME_KEY[school]],
        ),
      ),
    );

    const failedSchools: NarrativeSchool[] = [];
    let narrativesGenerated = 0;
    settled.forEach((s, i) => {
      if (s.status === "fulfilled") narrativesGenerated += 1;
      else failedSchools.push(SCHOOLS[i]);
    });

    return {
      overallVibe: dailyResult.triNation.overallVibe,
      frameCached: dailyResult.fromCache,
      narrativesGenerated,
      narrativesFailed: failedSchools.length,
      failedSchools,
    };
  },
  concurrency: 2,
  extra: async () => ({ forDate: kstTodayDate() }),
});
