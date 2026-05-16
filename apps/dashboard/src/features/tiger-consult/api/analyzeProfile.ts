import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { playmcpProfiles } from "@/shared/lib/db/schema";
import type { PlaymcpProfileRow, PlayMCPAnalysisResult } from "@/entities/tiger-reading";
import { callTool } from "../lib/playmcp-client";
import { validateAnalysisResponse } from "../lib/validate";
import { getOrFetchAnalysis } from "../lib/cache";

export interface AnalyzeResult {
  profile: PlaymcpProfileRow;
  payload: PlayMCPAnalysisResult;
  fromCache: boolean;
}

export async function analyzeProfile(profileId: string): Promise<AnalyzeResult> {
  const rows = await db.select().from(playmcpProfiles).where(eq(playmcpProfiles.id, profileId)).limit(1);
  if (!rows[0]) {
    throw new Error(`playmcp_profile not found: ${profileId}`);
  }
  const profile = rows[0];
  const { payload, fromCache } = await getOrFetchAnalysis<PlayMCPAnalysisResult>({
    profileId: profile.id,
    inputHash: profile.inputHash,
    tool: "1fate-analyze_saju",
    fetcher: () =>
      callTool("1fate-analyze_saju", {
        birth_date: profile.birthDate,
        gender: profile.gender,
        birth_time: profile.birthTime,
        birth_city: profile.birthCity,
        calendar: profile.calendar,
      }),
    validator: (p) =>
      validateAnalysisResponse(p, {
        id: profile.id,
        nickname: profile.nickname,
        birthDate: profile.birthDate,
        gender: profile.gender as "male" | "female",
      }),
  });
  return { profile, payload, fromCache };
}
