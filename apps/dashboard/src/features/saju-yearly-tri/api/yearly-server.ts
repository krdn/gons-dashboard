// Saju 삼국 분석 v0.2 — 년운(歲運) 캐시/빌더 서버 헬퍼.
//
// 정책:
//  - 캐시 키: (profile_id, school='compose', target_year, input_hash, schema_version=1)
//  - input_hash: 정규화된 birth input + targetYear(JSON 결정형 join("|")) 의 sha256
//  - miss 시 buildTriNationYearlyFromBirth(sync) 호출 → frameJsonb 컬럼에 저장 후 리턴
//  - 같은 input + targetYear 로 재요청하면 캐시 row 재사용 (school='compose' 한정)
//
// v0.1 lifetime-server.ts 와의 차이:
//  - targetYear 추가 (cache key + input hash 포함)
//  - currentAge KST 기준 계산 (birthDate ↔ 현재 KST 시점 diff)
//  - buildTriNationYearlyFromBirth wrapper 호출 (lifetime 의 verifyConsensus 일관성)
import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  ALGORITHM_VERSION,
  buildTriNationYearlyFromBirth,
  type TriNationYearly,
} from "@gons/saju";
import { db } from "@/shared/lib/db/client";
import { fortuneProfiles, sajuYearlyTri } from "@/shared/lib/db/schema";

// SCHEMA_VERSION 정책: TriNationYearly 구조 변경 시 +1.
// 캐시 키 (profile_id, school, target_year, input_hash, schema_version) 가 달라져
// 기존 row 자동 무효화. v0.2 시작 시 1.
const SCHEMA_VERSION = 1;
const SCHOOL = "compose";

// 한국 표준 경도 — profile.longitudeDeg null 시 fallback. lifetime-server.ts 와 동일 값.
const DEFAULT_LONGITUDE_KR = 127;

/** 프로필 미존재 또는 소유권 불일치. route 에서 404 매핑. */
export class ProfileNotFoundError extends Error {
  constructor() {
    super("PROFILE_NOT_FOUND");
    this.name = "ProfileNotFoundError";
  }
}

/** 빌드 단계 실패 (입력 검증/만세력 합의 불일치 등). route 에서 422 매핑. */
export class YearlyBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YearlyBuildError";
  }
}

export interface GetYearlyResult {
  triNation: TriNationYearly;
  cachedAt: string;
  fromCache: boolean;
}

/**
 * KST 기준 현재 연도 — `targetYear` 쿼리가 누락된 경우 default.
 * Asia/Seoul 은 DST 없음 (UTC+9 고정) → Intl 으로 KST 연도 단순 추출.
 */
export function currentKstYear(now: Date = new Date()): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
  });
  return Number(formatter.format(now));
}

/**
 * 한국식 만 나이 (KST 기준) — birthDate (YYYY-MM-DD 로컬) 와 현재 KST 시점 diff.
 *
 * 사주에서의 currentAge 는 대운 단계 lookup 에만 쓰이므로 일/시 단위 정확도는 불필요.
 * 단순 year diff - (생일 미경과 시 -1) 로 충분.
 */
export function currentKstAge(
  birthDate: string,
  now: Date = new Date(),
): number {
  const [byStr, bmStr, bdStr] = birthDate.split("-");
  const birthY = Number(byStr);
  const birthM = Number(bmStr);
  const birthD = Number(bdStr);

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const parts = fmt.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const curY = get("year");
  const curM = get("month");
  const curD = get("day");

  let age = curY - birthY;
  if (curM < birthM || (curM === birthM && curD < birthD)) {
    age -= 1;
  }
  return age;
}

export async function getOrBuildYearly(
  profileId: string,
  userId: string,
  targetYear: number,
): Promise<GetYearlyResult> {
  // 1) 프로필 fetch (소유권 확인)
  const profile = await db.query.fortuneProfiles.findFirst({
    where: and(
      eq(fortuneProfiles.id, profileId),
      eq(fortuneProfiles.userId, userId),
    ),
  });
  if (!profile) throw new ProfileNotFoundError();

  // 2) calendar/gender Zod 검증 — DB schema text 라 enum 범위 보장 안 됨
  const calendarParsed = z
    .enum(["solar", "lunar"])
    .safeParse(profile.calendar ?? "solar");
  const genderParsed = z.enum(["male", "female"]).safeParse(profile.gender);
  if (!calendarParsed.success) {
    throw new YearlyBuildError(`INVALID_CALENDAR: ${profile.calendar}`);
  }
  if (!genderParsed.success) {
    throw new YearlyBuildError(`INVALID_GENDER: ${profile.gender}`);
  }

  // 3) birthTime null/empty → "12:00" default (lifetime-server.ts 와 동일 정책)
  const birthTimeLocal = profile.birthTime?.trim() || "12:00";

  // 4) 입력 정규화 → BirthInputResolved
  const input = {
    birthDateLocal: profile.birthDate,
    birthTimeLocal,
    timezone: "Asia/Seoul" as const,
    longitudeDeg: Number(profile.longitudeDeg ?? DEFAULT_LONGITUDE_KR),
    calendar: calendarParsed.data,
    gender: genderParsed.data,
  };

  // 5) currentAge KST 기준 계산 — wrapper 에 그대로 전달
  const currentAge = currentKstAge(profile.birthDate);

  // 6) inputHash — birth 필드 + targetYear 명시 join.
  //    targetYear 가 같은 (profile_id, school, schema_version) 와 함께 cache key 를
  //    구성하므로 input_hash 자체에는 birth 필드만 반영하면 cache key 가 정상 작동하지만,
  //    실수로 cache key 가 (profile, target_year) 단일이 되더라도 무음 miss 가 발생하도록
  //    hash 안에 targetYear 를 박아 결정성 강화.
  const inputHash = createHash("sha256")
    .update(
      [
        input.birthDateLocal,
        input.birthTimeLocal,
        input.timezone,
        String(input.longitudeDeg),
        input.calendar,
        input.gender,
        String(targetYear),
      ].join("|"),
    )
    .digest("hex");

  // 7) 캐시 조회
  const cached = await db.query.sajuYearlyTri.findFirst({
    where: and(
      eq(sajuYearlyTri.profileId, profileId),
      eq(sajuYearlyTri.school, SCHOOL),
      eq(sajuYearlyTri.targetYear, targetYear),
      eq(sajuYearlyTri.inputHash, inputHash),
      eq(sajuYearlyTri.schemaVersion, SCHEMA_VERSION),
      eq(sajuYearlyTri.algorithmVersion, ALGORITHM_VERSION),
    ),
  });
  if (cached) {
    return {
      triNation: cached.frameJsonb,
      cachedAt: cached.computedAt.toISOString(),
      fromCache: true,
    };
  }

  // 8) miss → 빌드 (sync, Result<TriNationYearly>)
  const result = buildTriNationYearlyFromBirth({
    input,
    targetYear,
    currentAge,
  });
  if (!result.ok) throw new YearlyBuildError(result.error.message);

  // 9) 캐시에 저장 — 동시 cache miss 시 unique violation 회피 (idempotent)
  //    sajuYearlyTri 의 uniqueIndex (profileId, school, targetYear, inputHash, schemaVersion).
  await db
    .insert(sajuYearlyTri)
    .values({
      profileId,
      school: SCHOOL,
      targetYear,
      inputHash,
      schemaVersion: SCHEMA_VERSION,
      algorithmVersion: ALGORITHM_VERSION,
      frameJsonb: result.value,
    })
    .onConflictDoNothing();

  return {
    triNation: result.value,
    cachedAt: new Date().toISOString(),
    fromCache: false,
  };
}
