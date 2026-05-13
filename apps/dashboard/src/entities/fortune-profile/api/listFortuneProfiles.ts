import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { fortuneProfiles } from "@/shared/lib/db/schema";
import type { Calendar, FortuneProfile, Gender, Relation } from "../model/types";

export async function listFortuneProfiles(
  userId: string,
): Promise<FortuneProfile[]> {
  const rows = await db
    .select()
    .from(fortuneProfiles)
    .where(eq(fortuneProfiles.userId, userId))
    .orderBy(asc(fortuneProfiles.createdAt));

  return rows.map((r) => ({
    ...r,
    relation: r.relation as Relation,
    calendar: r.calendar as Calendar,
    gender: r.gender as Gender,
  }));
}
