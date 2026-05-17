// /api/saju/lifetime/[profileId] 영역 — DB CASCADE 회귀 테스트.
//
// 검증: fortune_profiles 행 삭제 시 saju_lifetime_tri 캐시 행이 함께 사라지는지.
//   (schema.ts 의 `references(..., { onDelete: "cascade" })` 가 ALTER TABLE 까지
//    내려갔는지 — 마이그레이션 회귀 방지 목적)
//
// 실행 정책:
//   - TEST_DATABASE_URL 이 명시되면 실제 DB 에 INSERT/DELETE 수행
//   - 미명시 시 describe.skip — CI / 로컬 DB 미기동 환경 안전
//   - tests/setup.ts 의 allow-list 가드가 prod DB 호스트는 어차피 throw 처리
//
// db import: barrel(`@/shared/lib/db`) 가 아닌 `@/shared/lib/db/client` 사용 —
// 기존 integration test (saju-cron-daily.integration.test.ts) 패턴과 일치.

/* eslint-disable @typescript-eslint/no-explicit-any -- integration test fixtures */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  fortuneProfiles,
  sajuLifetimeTri,
  users,
} from "@/shared/lib/db/schema";

const RUN = process.env.TEST_DATABASE_URL ? describe : describe.skip;

// 고정 UUID — saju-cron-daily.integration.test.ts 와 다른 대역 (99994~).
const TEST_USER_ID = "00000000-0000-0000-0000-000000099994";
const TEST_PROFILE_ID = "00000000-0000-0000-0000-000000099995";

RUN("Saju Tri Lifetime — DB CASCADE", () => {
  beforeAll(async () => {
    // 잔여 행이 남아있을 수 있으니 역순으로 선제 정리.
    await db
      .delete(sajuLifetimeTri)
      .where(eq(sajuLifetimeTri.profileId, TEST_PROFILE_ID));
    await db
      .delete(fortuneProfiles)
      .where(eq(fortuneProfiles.id, TEST_PROFILE_ID));
    await db.delete(users).where(eq(users.id, TEST_USER_ID));

    await db
      .insert(users)
      .values({
        id: TEST_USER_ID,
        email: "saju-tri-cascade-test@example.com",
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    // fortune_profiles 는 it() 안에서 CASCADE 검증 후 이미 삭제되었지만,
    // 테스트 중간 실패 시 잔여물을 남기지 않도록 안전망 정리.
    await db
      .delete(sajuLifetimeTri)
      .where(eq(sajuLifetimeTri.profileId, TEST_PROFILE_ID));
    await db
      .delete(fortuneProfiles)
      .where(eq(fortuneProfiles.id, TEST_PROFILE_ID));
    await db.delete(users).where(eq(users.id, TEST_USER_ID));
  });

  it("fortune_profiles 삭제 시 saju_lifetime_tri 가 CASCADE 로 함께 삭제된다", async () => {
    const [profile] = await db
      .insert(fortuneProfiles)
      .values({
        id: TEST_PROFILE_ID,
        userId: TEST_USER_ID,
        name: "tri-cascade-test",
        relation: "self",
        birthDate: "1967-03-29",
        birthTime: "05:30",
        calendar: "solar",
        gender: "male",
        longitudeDeg: "126.78",
      } as any)
      .returning();
    expect(profile.id).toBe(TEST_PROFILE_ID);

    await db.insert(sajuLifetimeTri).values({
      profileId: TEST_PROFILE_ID,
      school: "ko",
      inputHash: "cascade-test-hash",
      // Task 6.1 carry-over (commit 1c09984) 에서 SCHEMA_VERSION = 2 로 올림.
      // fixture 도 일관 유지.
      schemaVersion: 2,
      frameJsonb: {} as any,
    });

    // 사전 확인 — INSERT 가 실제로 들어갔는지.
    const before = await db.query.sajuLifetimeTri.findMany({
      where: eq(sajuLifetimeTri.profileId, TEST_PROFILE_ID),
    });
    expect(before.length).toBe(1);

    // 부모 행 삭제 → CASCADE 발동 기대.
    await db
      .delete(fortuneProfiles)
      .where(eq(fortuneProfiles.id, TEST_PROFILE_ID));

    const orphan = await db.query.sajuLifetimeTri.findMany({
      where: eq(sajuLifetimeTri.profileId, TEST_PROFILE_ID),
    });
    expect(orphan.length).toBe(0);
  });
});
