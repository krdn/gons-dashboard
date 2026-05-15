import { describe, expect, it, beforeAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  playmcpProfiles, playmcpAnalysis, playmcpYearly, playmcpDaily,
  playmcpCompatibility, users,
} from "@/shared/lib/db/schema";

// 통합 테스트: TEST_DATABASE_URL 설정 필요 (Gotcha #2).
// 실행: TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test

let testUserId: string;

beforeAll(async () => {
  const [u] = await db
    .insert(users)
    .values({ name: "tiger-test", email: `tiger-${Date.now()}@test.local` })
    .returning({ id: users.id });
  testUserId = u.id;
});

afterEach(async () => {
  await db.delete(playmcpProfiles).where(eq(playmcpProfiles.userId, testUserId));
});

describe("playmcp_profiles CASCADE + CHECK", () => {
  it("profile 삭제 시 analysis/yearly/daily 캐시 모두 CASCADE", async () => {
    const [profile] = await db.insert(playmcpProfiles).values({
      userId: testUserId,
      nickname: "test", relation: "self",
      birthDate: "1990-01-01", calendar: "solar", gender: "male",
      birthTime: null, birthCity: null,
      inputHash: "test-hash",
    }).returning();

    await db.insert(playmcpAnalysis).values({
      profileId: profile.id, inputHash: "test-hash", payload: {}, validatedAt: new Date(),
    });
    await db.insert(playmcpYearly).values({
      profileId: profile.id, year: 2026, inputHash: "test-hash", payload: {}, validatedAt: new Date(),
    });
    await db.insert(playmcpDaily).values({
      profileId: profile.id, forDateKst: "2026-05-15", inputHash: "test-hash", payload: {}, validatedAt: new Date(),
    });

    await db.delete(playmcpProfiles).where(eq(playmcpProfiles.id, profile.id));

    const a = await db.select().from(playmcpAnalysis).where(eq(playmcpAnalysis.profileId, profile.id));
    const y = await db.select().from(playmcpYearly).where(eq(playmcpYearly.profileId, profile.id));
    const d = await db.select().from(playmcpDaily).where(eq(playmcpDaily.profileId, profile.id));
    expect(a).toHaveLength(0);
    expect(y).toHaveLength(0);
    expect(d).toHaveLength(0);
  });

  it("compatibility CHECK (profile1 < profile2) — 잘못된 순서 INSERT 시 에러", async () => {
    const [pA] = await db.insert(playmcpProfiles).values({
      userId: testUserId, nickname: "A", relation: "self", birthDate: "1990-01-01",
      calendar: "solar", gender: "male", birthTime: null, birthCity: null, inputHash: "a",
    }).returning();
    const [pB] = await db.insert(playmcpProfiles).values({
      userId: testUserId, nickname: "B", relation: "friend", birthDate: "1991-01-01",
      calendar: "solar", gender: "female", birthTime: null, birthCity: null, inputHash: "b",
    }).returning();
    const [first, second] = [pA.id, pB.id].sort();
    // 정상 INSERT
    await db.insert(playmcpCompatibility).values({
      profile1Id: first, profile2Id: second,
      inputHash1: "a", inputHash2: "b",
      payload: {}, validatedAt: new Date(),
    });
    // 잘못된 순서 — DB CHECK 거부
    await expect(
      db.insert(playmcpCompatibility).values({
        profile1Id: second, profile2Id: first,
        inputHash1: "b", inputHash2: "a",
        payload: {}, validatedAt: new Date(),
      }),
    ).rejects.toThrow();
  });
});
