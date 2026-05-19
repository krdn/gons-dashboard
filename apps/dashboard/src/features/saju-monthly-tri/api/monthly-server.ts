// Saju 삼국 분석 v0.3 — 월운(月運) 캐시/빌더 서버 헬퍼.
//
// 정책 (yearly-server.ts 패턴 미러링):
//  - 캐시 키: (profile_id, school='compose', target_year, target_month, input_hash,
//             schema_version=1, algorithm_version)
//  - input_hash: 정규화된 birth input + targetYear + targetMonth (join("|")) 의 sha256
//  - miss 시 buildTriNationMonthlyFromBirth(sync) 호출 → frameJsonb 컬럼에 저장 후 리턴
//  - 같은 input + (targetYear, targetMonth) 로 재요청하면 캐시 row 재사용
//
// resolveBirthInput (Phase 1) 재사용 — profile fetch + Zod 검증 + BirthInputResolved
// + currentAge 한 번에 처리. cache+build glue 만 이 파일에 남는다.
import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  ALGORITHM_VERSION,
  buildTriNationMonthlyFromBirth,
  type TriNationMonthly,
} from "@gons/saju";
import { db } from "@/shared/lib/db/client";
import { sajuMonthlyTri } from "@/shared/lib/db/schema";
import {
  BirthInputValidationError,
  ProfileNotFoundError,
  currentKstMonth,
  currentKstYear,
  resolveBirthInput,
} from "@/shared/lib/saju/resolveBirthInput";

// SCHEMA_VERSION: TriNationMonthly 구조 변경 시 +1.
// 캐시 키 (profile_id, school, target_year, target_month, input_hash, schema_version) 가
// 달라져 기존 row 자동 무효화. v0.3 시작 시 1.
const SCHEMA_VERSION = 1;
const SCHOOL = "compose";

// 외부 호출자(route.ts, narrative-server.ts) 호환 re-export.
export { ProfileNotFoundError, currentKstMonth, currentKstYear };

/** 빌드 단계 실패 (입력 검증/만세력 합의 불일치 등). route 에서 422 매핑. */
export class MonthlyBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MonthlyBuildError";
  }
}

export interface GetMonthlyResult {
  triNation: TriNationMonthly;
  cachedAt: string;
  fromCache: boolean;
}

export async function getOrBuildMonthly(
  profileId: string,
  userId: string,
  targetYear: number,
  targetMonth: number,
): Promise<GetMonthlyResult> {
  // 1) 프로필 fetch + birth input 정규화 + currentAge (KST) — 한 번에.
  let resolved;
  try {
    resolved = await resolveBirthInput(profileId, userId);
  } catch (err) {
    if (err instanceof BirthInputValidationError) {
      throw new MonthlyBuildError(err.message);
    }
    throw err;
  }
  const { input, currentAge } = resolved;

  // 2) inputHash — birth 필드 + (targetYear, targetMonth) 명시 join.
  //    cache key 가 분리 컬럼이라 hash 가 (year,month) 없어도 작동하지만, 결정성
  //    강화 원칙 (yearly-server.ts §6 주석) 따라 hash 에도 박는다.
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
        String(targetMonth),
      ].join("|"),
    )
    .digest("hex");

  // 3) 캐시 조회
  const cached = await db.query.sajuMonthlyTri.findFirst({
    where: and(
      eq(sajuMonthlyTri.profileId, profileId),
      eq(sajuMonthlyTri.school, SCHOOL),
      eq(sajuMonthlyTri.targetYear, targetYear),
      eq(sajuMonthlyTri.targetMonth, targetMonth),
      eq(sajuMonthlyTri.inputHash, inputHash),
      eq(sajuMonthlyTri.schemaVersion, SCHEMA_VERSION),
      eq(sajuMonthlyTri.algorithmVersion, ALGORITHM_VERSION),
    ),
  });
  if (cached) {
    return {
      triNation: cached.frameJsonb,
      cachedAt: cached.computedAt.toISOString(),
      fromCache: true,
    };
  }

  // 4) miss → 빌드 (sync, Result<TriNationMonthly>)
  const result = buildTriNationMonthlyFromBirth({
    input,
    targetYear,
    targetMonth,
    currentAge,
  });
  if (!result.ok) throw new MonthlyBuildError(result.error.message);

  // 5) 캐시 저장 — 동시 cache miss 시 unique violation 회피 (idempotent)
  //    sajuMonthlyTri 의 uniqueIndex (profileId, school, targetYear, targetMonth,
  //                                    inputHash, schemaVersion, algorithmVersion).
  //    CHECK 제약: school IN (...) + target_month BETWEEN 1 AND 12 — 위반 시 throw,
  //    route 에서 500 매핑 (UI 가 month 1..12 만 전달하므로 운영에서는 도달 불가).
  await db
    .insert(sajuMonthlyTri)
    .values({
      profileId,
      school: SCHOOL,
      targetYear,
      targetMonth,
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
