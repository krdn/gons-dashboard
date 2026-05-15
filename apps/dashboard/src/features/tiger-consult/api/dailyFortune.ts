import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { playmcpProfiles } from "@/shared/lib/db/schema";
import type { PlaymcpProfileRow, PlayMCPDailyResult } from "@/entities/tiger-reading";
import { callTool } from "../lib/playmcp-client";
import { validateDailyResponse } from "../lib/validate";
import { getOrFetchDaily } from "../lib/cache";
import { computeKstDate } from "../lib/kst";

export interface DailyResult {
  profile: PlaymcpProfileRow;
  payload: PlayMCPDailyResult;
  forDateKst: string;
  fromCache: boolean;
}

export async function getDailyFortune(profileId: string): Promise<DailyResult> {
  const rows = await db.select().from(playmcpProfiles).where(eq(playmcpProfiles.id, profileId)).limit(1);
  if (!rows[0]) {
    throw new Error(`playmcp_profile not found: ${profileId}`);
  }
  const profile = rows[0];
  const forDateKst = computeKstDate();
  const { payload, fromCache } = await getOrFetchDaily<PlayMCPDailyResult>({
    profileId: profile.id,
    inputHash: profile.inputHash,
    forDateKst,
    tool: "1fate-get_daily_fortune",
    fetcher: () =>
      callTool("1fate-get_daily_fortune", {
        birth_date: profile.birthDate,
        gender: profile.gender,
        birth_time: profile.birthTime,
        birth_city: profile.birthCity,
        calendar: profile.calendar,
      }),
    validator: (p) =>
      validateDailyResponse(p, {
        id: profile.id,
        nickname: profile.nickname,
        birthDate: profile.birthDate,
        gender: profile.gender as "male" | "female",
      }),
  });
  return { profile, payload, forDateKst, fromCache };
}
