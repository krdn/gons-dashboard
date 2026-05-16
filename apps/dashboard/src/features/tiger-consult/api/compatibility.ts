import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { playmcpProfiles } from "@/shared/lib/db/schema";
import type { PlaymcpProfileRow, PlayMCPCompatibilityResult } from "@/entities/tiger-reading";
import { callTool } from "../lib/playmcp-client";
import { validateCompatibilityResponse } from "../lib/validate";
import { getOrFetchCompatibility } from "../lib/cache";
import { computePairInputHash } from "../lib/hash";

export interface CompatResult {
  profile1: PlaymcpProfileRow;
  profile2: PlaymcpProfileRow;
  payload: PlayMCPCompatibilityResult;
  fromCache: boolean;
}

export async function getCompatibility(aId: string, bId: string): Promise<CompatResult> {
  if (aId === bId) {
    throw new Error("getCompatibility: 같은 profileId 로 호출 불가");
  }
  const rows = await db.select().from(playmcpProfiles).where(inArray(playmcpProfiles.id, [aId, bId]));
  if (rows.length !== 2) {
    throw new Error(`compatibility profile 부분 누락: requested=[${aId},${bId}] found=${rows.length}`);
  }
  const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
  const [p1, p2] = sorted;
  const pairHash = computePairInputHash(p1.inputHash, p2.inputHash);

  const { payload, fromCache } = await getOrFetchCompatibility<PlayMCPCompatibilityResult>({
    profile1Id: p1.id,
    profile2Id: p2.id,
    inputHash1: p1.inputHash,
    inputHash2: p2.inputHash,
    pairHash,
    tool: "1fate-check_compatibility",
    fetcher: () =>
      callTool("1fate-check_compatibility", {
        person1_birth_date: p1.birthDate,
        person1_gender: p1.gender,
        person1_birth_time: p1.birthTime,
        person1_calendar: p1.calendar,
        person2_birth_date: p2.birthDate,
        person2_gender: p2.gender,
        person2_birth_time: p2.birthTime,
        person2_calendar: p2.calendar,
      }),
    validator: (resp) =>
      validateCompatibilityResponse(
        resp,
        { id: p1.id, nickname: p1.nickname, birthDate: p1.birthDate, gender: p1.gender as "male" | "female" },
        { id: p2.id, nickname: p2.nickname, birthDate: p2.birthDate, gender: p2.gender as "male" | "female" },
      ),
  });
  return { profile1: p1, profile2: p2, payload, fromCache };
}
