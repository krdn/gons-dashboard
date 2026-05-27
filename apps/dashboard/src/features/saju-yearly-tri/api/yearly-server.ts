import "server-only";
import { and, eq } from "drizzle-orm";
import {
  ALGORITHM_VERSION,
  buildTriNationYearlyFromBirth,
  type TriNationYearly,
} from "@krdn/saju";
import { db } from "@/shared/lib/db/client";
import { sajuYearlyTri } from "@/shared/lib/db/schema";
import {
  ProfileNotFoundError,
  currentKstAge,
  currentKstYear,
} from "@/shared/lib/saju/resolveBirthInput";
import { createSajuTriCache, type GetSajuTriResult } from "@/shared/lib/saju/getOrBuildSajuTriCache";

const SCHEMA_VERSION = 1;
const SCHOOL = "compose";

export { ProfileNotFoundError, currentKstAge, currentKstYear };

export class YearlyBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YearlyBuildError";
  }
}

export type GetYearlyResult = GetSajuTriResult<TriNationYearly>;

const _getOrBuild = createSajuTriCache<TriNationYearly, { targetYear: number }>({
  name: "yearly",
  schemaVersion: SCHEMA_VERSION,
  extraHashKeys: ({ targetYear }) => [String(targetYear)],
  async findCached({ profileId, inputHash, algorithmVersion, params }) {
    return db.query.sajuYearlyTri.findFirst({
      where: and(
        eq(sajuYearlyTri.profileId, profileId),
        eq(sajuYearlyTri.school, SCHOOL),
        eq(sajuYearlyTri.targetYear, params.targetYear),
        eq(sajuYearlyTri.inputHash, inputHash),
        eq(sajuYearlyTri.schemaVersion, SCHEMA_VERSION),
        eq(sajuYearlyTri.algorithmVersion, algorithmVersion),
      ),
    });
  },
  async insertCache({ profileId, inputHash, algorithmVersion, frame, params }) {
    await db.insert(sajuYearlyTri).values({
      profileId,
      school: SCHOOL,
      targetYear: params.targetYear,
      inputHash,
      schemaVersion: SCHEMA_VERSION,
      algorithmVersion,
      frameJsonb: frame,
    }).onConflictDoNothing();
  },
  build({ input, currentAge, params }) {
    return buildTriNationYearlyFromBirth({ input, targetYear: params.targetYear, currentAge });
  },
  BuildError: YearlyBuildError,
});

export async function getOrBuildYearly(
  profileId: string,
  userId: string,
  targetYear: number,
): Promise<GetYearlyResult> {
  return _getOrBuild(profileId, userId, { targetYear }, ALGORITHM_VERSION);
}
