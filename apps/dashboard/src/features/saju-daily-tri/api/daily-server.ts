// Saju 삼국 분석 v0.3 — tri 일진(日辰) 캐시/빌더 서버 헬퍼.
//
// 정책 (monthly-server.ts 패턴 + forDate):
//  - 캐시 키: (profile_id, for_date, input_hash, schema_version=1, algorithm_version)
//    * monthly/yearly 와 달리 school 컬럼 없음 — TriNationDailyLite 가 4학파 frame 을
//      한 row 의 jsonb 에 담음 (spec §3.5)
//  - input_hash: 정규화된 birth input + forDate (join("|")) 의 sha256
//  - miss 시 buildTriNationDailyLiteFromBirth(sync) 호출 → frameJsonb 저장 후 리턴
//
// resolveBirthInput (Phase 1) 재사용 — currentAge 는 daily 빌드에 미사용 (computeMajorFortunes
// 호출 안 함) 이지만 helper 비용은 미미해 결과를 그대로 받고 unused.
import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  ALGORITHM_VERSION,
  buildTriNationDailyLiteFromBirth,
  type TriNationDailyLite,
} from "@krdn/saju";
import { db } from "@/shared/lib/db/client";
import { sajuDailyTri } from "@/shared/lib/db/schema";
import {
  BirthInputValidationError,
  ProfileNotFoundError,
  resolveBirthInput,
} from "@/shared/lib/saju/resolveBirthInput";

// SCHEMA_VERSION: TriNationDailyLite 구조 변경 시 +1.
const SCHEMA_VERSION = 1;

// 외부 호출자(cron route, Phase 6 widget) 호환 re-export.
export { ProfileNotFoundError };

/** 빌드 단계 실패 (입력 검증/만세력 합의 불일치 등). 호출자에서 422 매핑. */
export class DailyBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DailyBuildError";
  }
}

export interface GetDailyResult {
  triNation: TriNationDailyLite;
  cachedAt: string;
  fromCache: boolean;
}

export async function getOrBuildDaily(
  profileId: string,
  userId: string,
  forDate: string,
): Promise<GetDailyResult> {
  let resolved;
  try {
    resolved = await resolveBirthInput(profileId, userId);
  } catch (err) {
    if (err instanceof BirthInputValidationError) {
      throw new DailyBuildError(err.message);
    }
    throw err;
  }
  const { input } = resolved;

  // inputHash — birth 필드 + forDate 명시 join.
  // cache key 가 (profile_id, for_date, input_hash, schema_version, algorithm_version)
  // 라 hash 가 forDate 없어도 작동하지만, 결정성 강화 원칙 일관 적용.
  const inputHash = createHash("sha256")
    .update(
      [
        input.birthDateLocal,
        input.birthTimeLocal,
        input.timezone,
        String(input.longitudeDeg),
        input.calendar,
        input.gender,
        forDate,
      ].join("|"),
    )
    .digest("hex");

  const cached = await db.query.sajuDailyTri.findFirst({
    where: and(
      eq(sajuDailyTri.profileId, profileId),
      eq(sajuDailyTri.forDate, forDate),
      eq(sajuDailyTri.inputHash, inputHash),
      eq(sajuDailyTri.schemaVersion, SCHEMA_VERSION),
      eq(sajuDailyTri.algorithmVersion, ALGORITHM_VERSION),
    ),
  });
  if (cached) {
    return {
      triNation: cached.frameJsonb,
      cachedAt: cached.computedAt.toISOString(),
      fromCache: true,
    };
  }

  const result = buildTriNationDailyLiteFromBirth({ input, forDate });
  if (!result.ok) throw new DailyBuildError(result.error.message);

  await db
    .insert(sajuDailyTri)
    .values({
      profileId,
      forDate,
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
