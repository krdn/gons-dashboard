/**
 * Saju Phase 1 통합 테스트 — hash 무효화 시나리오.
 *
 * 실 DB 가 필요하다 (`TEST_DATABASE_URL`). DB 미연결 시 ECONNREFUSED 로
 * fail 처리되는 것은 CLAUDE.md Gotcha #2 의 의도된 동작 — 로컬 DB 없는
 * CI 에서는 다른 통합 테스트들과 동일하게 ECONNREFUSED 로 묶인다.
 *
 * 시나리오:
 *   1. 같은 입력 → generateChart 두 번째 호출 inserted=false (재사용)
 *   2. 도시 변경 → revalidateSajuChart invalidated=true + readings CASCADE 삭제
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  fortuneProfiles,
  sajuCharts,
  sajuReadings,
  users,
} from "@/shared/lib/db/schema";
import { generateChart } from "@/features/saju-reading/api/generateChart";
import { revalidateSajuChart } from "@/features/saju-reading/api/revalidateSajuChart";

const TEST_USER_ID = "00000000-0000-0000-0000-000000099991";
const TEST_PROFILE_ID = "00000000-0000-0000-0000-000000099992";

describe("saju-reading hash 무효화 통합", () => {
  beforeAll(async () => {
    await db
      .insert(users)
      .values({ id: TEST_USER_ID, email: "saju-test@example.com" })
      .onConflictDoNothing();
    await db
      .insert(fortuneProfiles)
      .values({
        id: TEST_PROFILE_ID,
        userId: TEST_USER_ID,
        name: "테스트",
        relation: "self",
        birthDate: "1967-03-29",
        birthTime: "05:30",
        calendar: "solar",
        gender: "male",
        birthCity: null,
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db.delete(fortuneProfiles).where(eq(fortuneProfiles.id, TEST_PROFILE_ID));
    await db.delete(users).where(eq(users.id, TEST_USER_ID));
  });

  it("같은 입력 → 두 번째 호출 inserted=false (재사용)", async () => {
    const first = await generateChart({
      profileId: TEST_PROFILE_ID,
      birthDate: "1967-03-29",
      birthTime: "05:30",
      calendar: "solar",
      gender: "male",
      birthCity: null,
    });
    expect(first.inserted).toBe(true);

    const second = await generateChart({
      profileId: TEST_PROFILE_ID,
      birthDate: "1967-03-29",
      birthTime: "05:30",
      calendar: "solar",
      gender: "male",
      birthCity: null,
    });
    expect(second.inserted).toBe(false);
    expect(second.chart.id).toBe(first.chart.id);
  });

  it("도시 다르면 hash 변경 → invalidated=true + readings CASCADE 삭제", async () => {
    const [chartRow] = await db
      .select()
      .from(sajuCharts)
      .where(eq(sajuCharts.profileId, TEST_PROFILE_ID))
      .limit(1);
    expect(chartRow).toBeDefined();

    await db
      .insert(sajuReadings)
      .values({
        chartId: chartRow.id,
        section: "overview",
        body: "테스트 해설",
        model: "claude-opus-4-7",
      })
      .onConflictDoNothing();

    const result = await revalidateSajuChart({
      profileId: TEST_PROFILE_ID,
      newInput: {
        birthDate: "1967-03-29",
        birthTime: "05:30",
        calendar: "solar",
        gender: "male",
        birthCity: "Seoul",
      },
    });
    expect(result.invalidated).toBe(true);

    // 이전 chartId 로 readings 가 남아있지 않아야 함 (CASCADE).
    const remaining = await db
      .select()
      .from(sajuReadings)
      .where(eq(sajuReadings.chartId, chartRow.id));
    expect(remaining).toHaveLength(0);
  });
});
