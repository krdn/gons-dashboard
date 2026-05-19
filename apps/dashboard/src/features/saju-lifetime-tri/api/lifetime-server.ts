// Saju 삼국 분석 v0.1 — 평생 운세 캐시/빌더 서버 헬퍼.
//
// 정책:
//  - 캐시 키: (profile_id, school='compose', input_hash, schema_version=2)
//  - input_hash: 정규화된 birth input 의 sha256 (필드 순서 코드 고정)
//  - miss 시 buildTriNationLifetime(sync) 호출 → frameJsonb 컬럼에 결과 저장 후 리턴
//  - 같은 input 으로 재요청하면 캐시 row 가 그대로 재사용된다 (school='compose' 한정)
//
// v0.3 Phase 1 리팩터: birth input 정규화를 `shared/lib/saju/resolveBirthInput` 으로
// 분리. cache+build glue 만 이 파일에 남는다. currentAge 는 lifetime 빌드에 쓰지 않아
// 결과를 무시한다 (extras 가 비어있는 케이스의 호환 패턴).
import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { ALGORITHM_VERSION, buildTriNationLifetime, type TriNationLifetime } from "@gons/saju";
import { db } from "@/shared/lib/db/client";
import { sajuLifetimeTri } from "@/shared/lib/db/schema";
import {
  BirthInputValidationError,
  ProfileNotFoundError,
  resolveBirthInput,
} from "@/shared/lib/saju/resolveBirthInput";

// SCHEMA_VERSION 정책: TriNationLifetime 구조 변경 시 +1.
// 캐시 키 (profile_id, school, input_hash, schema_version) 가 달라져 기존 row 자동 무효화.
// v1 → v2 (2026-05-17): daeun.pillars 제거 (rawChart.majorFortunes 단일 소스).
//                       hash 입력 정규화 join("|") 으로 교체.
const SCHEMA_VERSION = 2;
const SCHOOL = "compose";

// 외부 호출자(route.ts, narrative-server.ts, SajuTriLifetime.tsx) 호환 re-export.
export { ProfileNotFoundError };

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
  // 1) 프로필 fetch + birth input 정규화. lifetime 은 currentAge 미사용 — 무시.
  //    BirthInputValidationError 는 LifetimeBuildError 로 래핑해 기존 422 매핑 유지.
  let resolved;
  try {
    resolved = await resolveBirthInput(profileId, userId);
  } catch (err) {
    if (err instanceof BirthInputValidationError) {
      throw new LifetimeBuildError(err.message);
    }
    throw err;
  }
  const { input } = resolved;

  // 2) inputHash — 명시적 join 정규화.
  //    JSON.stringify(input) 는 object literal 순서에 의존 → 향후 spread/build 패턴 도입 시
  //    같은 의미의 input 이 서로 다른 hash 가 되어 무음 cache miss 발생 위험.
  //    필드 순서를 코드에 고정해 결정성 보장.
  const inputHash = createHash("sha256")
    .update(
      [
        input.birthDateLocal,
        input.birthTimeLocal,
        input.timezone,
        String(input.longitudeDeg),
        input.calendar,
        input.gender,
      ].join("|"),
    )
    .digest("hex");

  // 3) 캐시 조회
  const cached = await db.query.sajuLifetimeTri.findFirst({
    where: and(
      eq(sajuLifetimeTri.profileId, profileId),
      eq(sajuLifetimeTri.school, SCHOOL),
      eq(sajuLifetimeTri.inputHash, inputHash),
      eq(sajuLifetimeTri.schemaVersion, SCHEMA_VERSION),
      eq(sajuLifetimeTri.algorithmVersion, ALGORITHM_VERSION),
    ),
  });
  if (cached) {
    return {
      triNation: cached.frameJsonb,
      cachedAt: cached.computedAt.toISOString(),
      fromCache: true,
    };
  }

  // 4) miss → 빌드 (sync, Result<TriNationLifetime>)
  const result = buildTriNationLifetime(input);
  if (!result.ok) throw new LifetimeBuildError(result.error.message);

  // 5) 캐시에 저장 — 동시 cache miss 시 unique violation 회피 (idempotent)
  //    sajuLifetimeTri 의 uniqueIndex (profileId, school, inputHash, schemaVersion).
  await db.insert(sajuLifetimeTri).values({
    profileId,
    school: SCHOOL,
    inputHash,
    schemaVersion: SCHEMA_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    frameJsonb: result.value,
  }).onConflictDoNothing();

  return {
    triNation: result.value,
    cachedAt: new Date().toISOString(),
    fromCache: false,
  };
}
