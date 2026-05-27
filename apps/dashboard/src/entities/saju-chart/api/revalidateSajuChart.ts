import "server-only";
import { eq } from "drizzle-orm";
import { hashProfile } from "@krdn/saju";
import type { ComputeSajuInput } from "@krdn/saju";
import { db } from "@/shared/lib/db/client";
import { sajuCharts } from "@/shared/lib/db/schema";

/**
 * Profile 변경 시 호출. input_hash 가 달라졌으면 chart 삭제
 * (CASCADE 로 readings 함께). 다음 ensureChartAndReadings 호출 시 자동 재생성.
 */
export async function revalidateSajuChart(input: {
  profileId: string;
  newInput: ComputeSajuInput;
}): Promise<{ invalidated: boolean }> {
  const newHash = hashProfile(input.newInput);
  const [existing] = await db
    .select({ id: sajuCharts.id, hash: sajuCharts.inputHash })
    .from(sajuCharts)
    .where(eq(sajuCharts.profileId, input.profileId))
    .limit(1);

  if (!existing) return { invalidated: false };
  if (existing.hash === newHash) return { invalidated: false };

  await db.delete(sajuCharts).where(eq(sajuCharts.id, existing.id));
  return { invalidated: true };
}
