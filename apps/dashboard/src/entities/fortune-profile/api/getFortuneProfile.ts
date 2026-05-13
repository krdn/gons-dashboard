import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { fortuneProfiles } from "@/shared/lib/db/schema";
import type { Calendar, FortuneProfile, Gender, Relation } from "../model/types";

export async function getFortuneProfile(
  id: string,
  userId: string,
): Promise<FortuneProfile | null> {
  const [row] = await db
    .select()
    .from(fortuneProfiles)
    .where(and(eq(fortuneProfiles.id, id), eq(fortuneProfiles.userId, userId)))
    .limit(1);

  if (!row) return null;
  return {
    ...row,
    relation: row.relation as Relation,
    calendar: row.calendar as Calendar,
    gender: row.gender as Gender,
  };
}
