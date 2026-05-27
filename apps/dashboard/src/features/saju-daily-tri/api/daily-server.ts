import "server-only";
import { and, eq } from "drizzle-orm";
import {
  ALGORITHM_VERSION,
  buildTriNationDailyLiteFromBirth,
  type TriNationDailyLite,
} from "@krdn/saju";
import { db } from "@/shared/lib/db/client";
import { sajuDailyTri } from "@/shared/lib/db/schema";
import { ProfileNotFoundError } from "@/shared/lib/saju/resolveBirthInput";
import { createSajuTriCache, type GetSajuTriResult } from "@/shared/lib/saju/getOrBuildSajuTriCache";

const SCHEMA_VERSION = 1;

export { ProfileNotFoundError };

export class DailyBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DailyBuildError";
  }
}

export type GetDailyResult = GetSajuTriResult<TriNationDailyLite>;

const _getOrBuild = createSajuTriCache<TriNationDailyLite, { forDate: string }>({
  name: "daily",
  schemaVersion: SCHEMA_VERSION,
  extraHashKeys: ({ forDate }) => [forDate],
  async findCached({ profileId, inputHash, algorithmVersion, params }) {
    return db.query.sajuDailyTri.findFirst({
      where: and(
        eq(sajuDailyTri.profileId, profileId),
        eq(sajuDailyTri.forDate, params.forDate),
        eq(sajuDailyTri.inputHash, inputHash),
        eq(sajuDailyTri.schemaVersion, SCHEMA_VERSION),
        eq(sajuDailyTri.algorithmVersion, algorithmVersion),
      ),
    });
  },
  async insertCache({ profileId, inputHash, algorithmVersion, frame, params }) {
    await db.insert(sajuDailyTri).values({
      profileId,
      forDate: params.forDate,
      inputHash,
      schemaVersion: SCHEMA_VERSION,
      algorithmVersion,
      frameJsonb: frame,
    }).onConflictDoNothing();
  },
  build({ input, params }) {
    return buildTriNationDailyLiteFromBirth({ input, forDate: params.forDate });
  },
  BuildError: DailyBuildError,
});

export async function getOrBuildDaily(
  profileId: string,
  userId: string,
  forDate: string,
): Promise<GetDailyResult> {
  return _getOrBuild(profileId, userId, { forDate }, ALGORITHM_VERSION);
}
