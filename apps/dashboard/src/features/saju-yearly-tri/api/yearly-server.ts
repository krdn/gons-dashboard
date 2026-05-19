// Saju 삼국 분석 v0.2 — 년운(歲運) 캐시/빌더 서버 헬퍼.
//
// 정책:
//  - 캐시 키: (profile_id, school='compose', target_year, input_hash, schema_version=1)
//  - input_hash: 정규화된 birth input + targetYear(JSON 결정형 join("|")) 의 sha256
//  - miss 시 buildTriNationYearlyFromBirth(sync) 호출 → frameJsonb 컬럼에 저장 후 리턴
//  - 같은 input + targetYear 로 재요청하면 캐시 row 재사용 (school='compose' 한정)
//
// v0.3 Phase 1 리팩터: birth input 정규화 + currentAge 계산 + KST 헬퍼를
// `shared/lib/saju/resolveBirthInput` 으로 분리. cache+build glue 만 이 파일에 남는다.
// 외부 호출자가 import 하는 ProfileNotFoundError / currentKstYear / currentKstAge 는
// re-export 로 호환 유지.
import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  ALGORITHM_VERSION,
  buildTriNationYearlyFromBirth,
  type TriNationYearly,
} from "@gons/saju";
import { db } from "@/shared/lib/db/client";
import { sajuYearlyTri } from "@/shared/lib/db/schema";
import {
  BirthInputValidationError,
  ProfileNotFoundError,
  currentKstAge,
  currentKstYear,
  resolveBirthInput,
} from "@/shared/lib/saju/resolveBirthInput";

// SCHEMA_VERSION 정책: TriNationYearly 구조 변경 시 +1.
// 캐시 키 (profile_id, school, target_year, input_hash, schema_version) 가 달라져
// 기존 row 자동 무효화. v0.2 시작 시 1.
const SCHEMA_VERSION = 1;
const SCHOOL = "compose";

// 외부 호출자(route.ts, narrative-server.ts, SajuTriYearly.tsx) 호환 re-export.
export { ProfileNotFoundError, currentKstAge, currentKstYear };

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

export async function getOrBuildYearly(
  profileId: string,
  userId: string,
  targetYear: number,
): Promise<GetYearlyResult> {
  // 1) 프로필 fetch + birth input 정규화 + currentAge (KST) 한 번에.
  //    BirthInputValidationError 는 YearlyBuildError 로 래핑해 기존 422 매핑 유지.
  let resolved;
  try {
    resolved = await resolveBirthInput(profileId, userId);
  } catch (err) {
    if (err instanceof BirthInputValidationError) {
      throw new YearlyBuildError(err.message);
    }
    throw err;
  }
  const { input, currentAge } = resolved;

  // 2) inputHash — birth 필드 + targetYear 명시 join.
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

  // 3) 캐시 조회
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

  // 4) miss → 빌드 (sync, Result<TriNationYearly>)
  const result = buildTriNationYearlyFromBirth({
    input,
    targetYear,
    currentAge,
  });
  if (!result.ok) throw new YearlyBuildError(result.error.message);

  // 5) 캐시에 저장 — 동시 cache miss 시 unique violation 회피 (idempotent)
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
