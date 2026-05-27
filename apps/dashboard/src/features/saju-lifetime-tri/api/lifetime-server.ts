import "server-only";
import { and, eq } from "drizzle-orm";
import { ALGORITHM_VERSION, buildTriNationLifetime, type TriNationLifetime } from "@krdn/saju";
import { db } from "@/shared/lib/db/client";
import { sajuLifetimeTri } from "@/shared/lib/db/schema";
import { ProfileNotFoundError } from "@/shared/lib/saju/resolveBirthInput";
import { createSajuTriCache, type GetSajuTriResult } from "@/shared/lib/saju/getOrBuildSajuTriCache";

const SCHEMA_VERSION = 2;
const SCHOOL = "compose";

export { ProfileNotFoundError };

export class LifetimeBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifetimeBuildError";
  }
}

export type GetLifetimeResult = GetSajuTriResult<TriNationLifetime>;

const _getOrBuild = createSajuTriCache<TriNationLifetime, Record<string, never>>({
  name: "lifetime",
  schemaVersion: SCHEMA_VERSION,
  extraHashKeys: () => [],
  async findCached({ profileId, inputHash, algorithmVersion }) {
    return db.query.sajuLifetimeTri.findFirst({
      where: and(
        eq(sajuLifetimeTri.profileId, profileId),
        eq(sajuLifetimeTri.school, SCHOOL),
        eq(sajuLifetimeTri.inputHash, inputHash),
        eq(sajuLifetimeTri.schemaVersion, SCHEMA_VERSION),
        eq(sajuLifetimeTri.algorithmVersion, algorithmVersion),
      ),
    });
  },
  async insertCache({ profileId, inputHash, algorithmVersion, frame }) {
    await db.insert(sajuLifetimeTri).values({
      profileId,
      school: SCHOOL,
      inputHash,
      schemaVersion: SCHEMA_VERSION,
      algorithmVersion,
      frameJsonb: frame,
    }).onConflictDoNothing();
  },
  build({ input }) {
    return buildTriNationLifetime(input);
  },
  BuildError: LifetimeBuildError,
});

export async function getOrBuildLifetime(
  profileId: string,
  userId: string,
): Promise<GetLifetimeResult> {
  return _getOrBuild(profileId, userId, {} as Record<string, never>, ALGORITHM_VERSION);
}
