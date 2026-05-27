// Saju 삼국 분석 v0.3 Phase 1 — yearly/lifetime/monthly/daily 가 공유하는 birth input 정규화.
//
// 발췌 출처: yearly-server.ts / lifetime-server.ts 의 단계 1-5 (profile fetch + Zod 검증 +
// birthTime default + BirthInputResolved 구축 + currentAge). lifetime 은 currentAge 를
// 사용하지 않지만 함께 계산하는 비용은 미미하므로 분기 없이 항상 반환한다.
//
// scope (prelude-only):
//  - profile 소유권 확인
//  - calendar/gender Zod 검증
//  - birthTime null/empty → "12:00" default
//  - longitude null → DEFAULT_LONGITUDE_KR fallback
//  - currentAge (KST 기준 만 나이) 계산
//
// NOT in scope: input hash 계산, cache 조회, build 호출. 이들은 각 *-server.ts 에 남는다.
//
// 에러 정책: ProfileNotFoundError (404 매핑), BirthInputValidationError (422 매핑).
// 각 호출자는 자체 BuildError(YearlyBuildError 등) 로 래핑하거나 그대로 던질 수 있다.
import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { BirthInputResolved } from "@krdn/saju";
import { db } from "@/shared/lib/db/client";
import { fortuneProfiles } from "@/shared/lib/db/schema";

// 한국 표준 경도 — profile.longitudeDeg null 시 fallback.
// (yearly-server.ts / lifetime-server.ts 와 동일 값. 향후 birthCity 지오코딩 도입 시 제거 가능.)
const DEFAULT_LONGITUDE_KR = 127;

/** 프로필 미존재 또는 소유권 불일치. route 에서 404 매핑. */
export class ProfileNotFoundError extends Error {
  constructor() {
    super("PROFILE_NOT_FOUND");
    this.name = "ProfileNotFoundError";
  }
}

/** birth input 검증 실패 (calendar/gender enum 등). route 에서 422 매핑. */
export class BirthInputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BirthInputValidationError";
  }
}

export interface ResolvedBirthContext {
  input: BirthInputResolved;
  /** KST 기준 만 나이 — yearly/monthly 에서 대운 lookup 에 사용. lifetime 은 미사용. */
  currentAge: number;
  /** profile.birthDate (정규화 입력의 birthDateLocal 과 동일). 호출자 편의용. */
  birthDate: string;
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
 * KST 기준 현재 월 (1..12) — Phase 3 monthly default 용.
 */
export function currentKstMonth(now: Date = new Date()): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    month: "numeric",
  });
  return Number(formatter.format(now));
}

/**
 * KST(Asia/Seoul) 기준 오늘 날짜 — "YYYY-MM-DD" 형식.
 *
 * DST 없음 가정 (한국은 1988 이후 미적용). UTC +9h offset 후 ISO slice.
 * @param now - 테스트용 주입 가능. 기본 new Date().
 */
export function currentKstDate(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
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

/**
 * profile fetch + birth input 정규화 + currentAge 계산을 한 번에 처리.
 *
 * 호출자(yearly/lifetime/monthly/daily server) 는 이 결과의 `input` 으로 hash/build,
 * `currentAge` 로 wrapper 호출(필요 시), `birthDate` 로 입력 확인용 메타 사용.
 */
export async function resolveBirthInput(
  profileId: string,
  userId: string,
): Promise<ResolvedBirthContext> {
  const profile = await db.query.fortuneProfiles.findFirst({
    where: and(
      eq(fortuneProfiles.id, profileId),
      eq(fortuneProfiles.userId, userId),
    ),
  });
  if (!profile) throw new ProfileNotFoundError();

  const calendarParsed = z
    .enum(["solar", "lunar"])
    .safeParse(profile.calendar ?? "solar");
  const genderParsed = z.enum(["male", "female"]).safeParse(profile.gender);
  if (!calendarParsed.success) {
    throw new BirthInputValidationError(`INVALID_CALENDAR: ${profile.calendar}`);
  }
  if (!genderParsed.success) {
    throw new BirthInputValidationError(`INVALID_GENDER: ${profile.gender}`);
  }

  // birthTime null/empty/whitespace → "12:00" default
  // (computePillars 는 "" 를 nullish 가 아닌 falsy 로 받아 NaN 연산 발생 — dashboard 에서 가드.)
  const birthTimeLocal = profile.birthTime?.trim() || "12:00";

  const input: BirthInputResolved = {
    birthDateLocal: profile.birthDate,
    birthTimeLocal,
    timezone: "Asia/Seoul" as const,
    longitudeDeg: Number(profile.longitudeDeg ?? DEFAULT_LONGITUDE_KR),
    calendar: calendarParsed.data,
    gender: genderParsed.data,
  };

  const currentAge = currentKstAge(profile.birthDate);

  return {
    input,
    currentAge,
    birthDate: profile.birthDate,
  };
}
