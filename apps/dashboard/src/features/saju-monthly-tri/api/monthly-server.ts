import "server-only";
import { and, eq } from "drizzle-orm";
import {
  ALGORITHM_VERSION,
  buildTriNationMonthlyFromBirth,
  type TriNationMonthly,
} from "@krdn/saju";
import { db } from "@/shared/lib/db/client";
import { sajuMonthlyTri } from "@/shared/lib/db/schema";
import {
  ProfileNotFoundError,
  currentKstMonth,
  currentKstYear,
} from "@/shared/lib/saju/resolveBirthInput";
import { createSajuTriCache, type GetSajuTriResult } from "@/shared/lib/saju/getOrBuildSajuTriCache";

const SCHEMA_VERSION = 1;
const SCHOOL = "compose";

export { ProfileNotFoundError, currentKstMonth, currentKstYear };

export class MonthlyBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MonthlyBuildError";
  }
}

export type GetMonthlyResult = GetSajuTriResult<TriNationMonthly>;

const _getOrBuild = createSajuTriCache<TriNationMonthly, { targetYear: number; targetMonth: number }>({
  name: "monthly",
  schemaVersion: SCHEMA_VERSION,
  extraHashKeys: ({ targetYear, targetMonth }) => [String(targetYear), String(targetMonth)],
  async findCached({ profileId, inputHash, algorithmVersion, params }) {
    return db.query.sajuMonthlyTri.findFirst({
      where: and(
        eq(sajuMonthlyTri.profileId, profileId),
        eq(sajuMonthlyTri.school, SCHOOL),
        eq(sajuMonthlyTri.targetYear, params.targetYear),
        eq(sajuMonthlyTri.targetMonth, params.targetMonth),
        eq(sajuMonthlyTri.inputHash, inputHash),
        eq(sajuMonthlyTri.schemaVersion, SCHEMA_VERSION),
        eq(sajuMonthlyTri.algorithmVersion, algorithmVersion),
      ),
    });
  },
  async insertCache({ profileId, inputHash, algorithmVersion, frame, params }) {
    await db.insert(sajuMonthlyTri).values({
      profileId,
      school: SCHOOL,
      targetYear: params.targetYear,
      targetMonth: params.targetMonth,
      inputHash,
      schemaVersion: SCHEMA_VERSION,
      algorithmVersion,
      frameJsonb: frame,
    }).onConflictDoNothing();
  },
  build({ input, currentAge, params }) {
    return buildTriNationMonthlyFromBirth({
      input,
      targetYear: params.targetYear,
      targetMonth: params.targetMonth,
      currentAge,
    });
  },
  BuildError: MonthlyBuildError,
});

export async function getOrBuildMonthly(
  profileId: string,
  userId: string,
  targetYear: number,
  targetMonth: number,
): Promise<GetMonthlyResult> {
  return _getOrBuild(profileId, userId, { targetYear, targetMonth }, ALGORITHM_VERSION);
}
