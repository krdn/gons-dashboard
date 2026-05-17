// Saju 삼국 분석 v0.1 — 평생 운세 캐시/빌더 서버 헬퍼.
//
// 정책:
//  - 캐시 키: (profile_id, school='compose', input_hash, schema_version=1)
//  - input_hash: 정규화된 birth input(JSON.stringify) 의 sha256
//  - miss 시 buildTriNationLifetime(sync) 호출 → frameJsonb 컬럼에 결과 저장 후 리턴
//  - 같은 input 으로 재요청하면 캐시 row 가 그대로 재사용된다 (school='compose' 한정)
import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { buildTriNationLifetime, type TriNationLifetime } from "@gons/saju";
import { db } from "@/shared/lib/db/client";
import { fortuneProfiles, sajuLifetimeTri } from "@/shared/lib/db/schema";

const SCHEMA_VERSION = 1;
const SCHOOL = "compose";

/** 프로필 미존재 또는 소유권 불일치. route 에서 404 매핑. */
export class ProfileNotFoundError extends Error {
  constructor() {
    super("PROFILE_NOT_FOUND");
    this.name = "ProfileNotFoundError";
  }
}

/** 빌드 단계 실패 (입력 검증/만세력 합의 불일치 등). route 에서 422 매핑. */
export class LifetimeBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifetimeBuildError";
  }
}

export interface GetLifetimeResult {
  triNation: TriNationLifetime;
  cachedAt: string;
  fromCache: boolean;
}

export async function getOrBuildLifetime(
  profileId: string,
  userId: string,
): Promise<GetLifetimeResult> {
  // 1) 프로필 fetch (소유권 확인 — profileId × userId)
  const profile = await db.query.fortuneProfiles.findFirst({
    where: and(
      eq(fortuneProfiles.id, profileId),
      eq(fortuneProfiles.userId, userId),
    ),
  });
  if (!profile) throw new ProfileNotFoundError();

  // 2) calendar/gender Zod 검증 — DB schema 는 text 라 enum 범위 보장 안 됨
  const calendarParsed = z.enum(["solar", "lunar"]).safeParse(profile.calendar ?? "solar");
  const genderParsed = z.enum(["male", "female"]).safeParse(profile.gender);
  if (!calendarParsed.success) {
    throw new LifetimeBuildError(`INVALID_CALENDAR: ${profile.calendar}`);
  }
  if (!genderParsed.success) {
    throw new LifetimeBuildError(`INVALID_GENDER: ${profile.gender}`);
  }

  // 3) birthTime null/empty/whitespace → "12:00" default
  //    saju 의 computePillars 는 birthTime ?? "12:00" 로 자체 default 하지만
  //    "" 는 nullish 가 아니라 falsy → NaN 연산 발생. dashboard 에서 명시 가드.
  //    (BirthInputResolved.birthTimeLocal: string 타입과 호환)
  const birthTimeLocal = profile.birthTime?.trim() || "12:00";

  // 4) 입력 정규화 → BirthInputResolved
  const input = {
    birthDateLocal: profile.birthDate,
    birthTimeLocal,
    timezone: "Asia/Seoul" as const,
    longitudeDeg: Number(profile.longitudeDeg ?? 127),
    calendar: calendarParsed.data,
    gender: genderParsed.data,
  };

  // 5) inputHash (정렬은 JSON.stringify 의 key 순서 — input object 리터럴 고정 순서라 안정)
  const inputHash = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");

  // 6) 캐시 조회
  const cached = await db.query.sajuLifetimeTri.findFirst({
    where: and(
      eq(sajuLifetimeTri.profileId, profileId),
      eq(sajuLifetimeTri.school, SCHOOL),
      eq(sajuLifetimeTri.inputHash, inputHash),
      eq(sajuLifetimeTri.schemaVersion, SCHEMA_VERSION),
    ),
  });
  if (cached) {
    return {
      triNation: cached.frameJsonb as TriNationLifetime,
      cachedAt: cached.computedAt.toISOString(),
      fromCache: true,
    };
  }

  // 7) miss → 빌드 (sync, Result<TriNationLifetime>)
  const result = buildTriNationLifetime(input);
  if (!result.ok) throw new LifetimeBuildError(result.error.message);

  // 8) 캐시에 저장 — 동시 cache miss 시 unique violation 회피 (idempotent)
  //    sajuLifetimeTri 의 uniqueIndex (profileId, school, inputHash, schemaVersion).
  await db.insert(sajuLifetimeTri).values({
    profileId,
    school: SCHOOL,
    inputHash,
    schemaVersion: SCHEMA_VERSION,
    frameJsonb: result.value as never,
  }).onConflictDoNothing();

  return {
    triNation: result.value,
    cachedAt: new Date().toISOString(),
    fromCache: false,
  };
}
