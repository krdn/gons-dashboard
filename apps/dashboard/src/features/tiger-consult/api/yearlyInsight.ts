import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { playmcpProfiles } from "@/shared/lib/db/schema";
import type { PlaymcpProfileRow, PlayMCPYearlyResult } from "@/entities/tiger-reading";
import { callTool } from "../lib/playmcp-client";
import { validateYearlyResponse } from "../lib/validate";
import { getOrFetchYearly } from "../lib/cache";
import { computeKstYear } from "../lib/kst";

export interface YearlyResult {
  profile: PlaymcpProfileRow;
  payload: PlayMCPYearlyResult;
  year: number;
  fromCache: boolean;
}

export async function getYearlyInsight(profileId: string, targetYear?: number): Promise<YearlyResult> {
  const rows = await db.select().from(playmcpProfiles).where(eq(playmcpProfiles.id, profileId)).limit(1);
  if (!rows[0]) {
    throw new Error(`playmcp_profile not found: ${profileId}`);
  }
  const profile = rows[0];
  const year = targetYear ?? computeKstYear();
  const { payload, fromCache } = await getOrFetchYearly<PlayMCPYearlyResult>({
    profileId: profile.id,
    inputHash: profile.inputHash,
    year,
    tool: "1fate-get_year_fortune",
    fetcher: () =>
      callTool("1fate-get_year_fortune", {
        birth_date: profile.birthDate,
        gender: profile.gender,
        birth_time: profile.birthTime,
        birth_city: profile.birthCity,
        calendar: profile.calendar,
        target_year: year,
      }),
    validator: (p) =>
      validateYearlyResponse(p, {
        id: profile.id,
        nickname: profile.nickname,
        birthDate: profile.birthDate,
        gender: profile.gender as "male" | "female",
      }),
  });
  return { profile, payload, year, fromCache };
}
