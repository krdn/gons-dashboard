// Saju tri cache-aside 팩토리 — lifetime/yearly/monthly/daily 4개 server 가 공유하는
// resolveBirthInput → inputHash → cache 조회 → build → idempotent upsert 시퀀스를
// 단일 factory 로 묶는다.
//
// 설계: thick adapter / thin factory — 각 wrapper 가 findCached, insertCache, build 함수를
// 제공. 팩토리는 hash 계산 + 에러 wrapping + orchestration 만 담당.
import "server-only";
import { createHash } from "node:crypto";
import {
  BirthInputValidationError,
  resolveBirthInput,
  type ResolvedBirthContext,
} from "@/shared/lib/saju/resolveBirthInput";

interface CacheHit<T> {
  frameJsonb: T;
  computedAt: Date;
}

export interface SajuTriCacheConfig<T, P> {
  name: string;
  schemaVersion: number;
  extraHashKeys: (params: P) => string[];
  findCached: (args: {
    profileId: string;
    inputHash: string;
    algorithmVersion: number;
    params: P;
  }) => Promise<CacheHit<T> | undefined>;
  insertCache: (args: {
    profileId: string;
    inputHash: string;
    algorithmVersion: number;
    frame: T;
    params: P;
  }) => Promise<void>;
  build: (args: {
    input: ResolvedBirthContext["input"];
    currentAge: number;
    params: P;
  }) => { ok: true; value: T } | { ok: false; error: { message: string } };
  BuildError: new (message: string) => Error;
}

export interface GetSajuTriResult<T> {
  triNation: T;
  cachedAt: string;
  fromCache: boolean;
}

export function createSajuTriCache<T, P>(config: SajuTriCacheConfig<T, P>) {
  return async function getOrBuild(
    profileId: string,
    userId: string,
    params: P,
    algorithmVersion: number,
  ): Promise<GetSajuTriResult<T>> {
    let resolved;
    try {
      resolved = await resolveBirthInput(profileId, userId);
    } catch (err) {
      if (err instanceof BirthInputValidationError) {
        throw new config.BuildError(err.message);
      }
      throw err;
    }
    const { input, currentAge } = resolved;

    const inputHash = createHash("sha256")
      .update(
        [
          input.birthDateLocal,
          input.birthTimeLocal,
          input.timezone,
          String(input.longitudeDeg),
          input.calendar,
          input.gender,
          ...config.extraHashKeys(params),
        ].join("|"),
      )
      .digest("hex");

    const cached = await config.findCached({
      profileId,
      inputHash,
      algorithmVersion,
      params,
    });
    if (cached) {
      return {
        triNation: cached.frameJsonb,
        cachedAt: cached.computedAt.toISOString(),
        fromCache: true,
      };
    }

    const result = config.build({ input, currentAge, params });
    if (!result.ok) throw new config.BuildError(result.error.message);

    await config.insertCache({
      profileId,
      inputHash,
      algorithmVersion,
      frame: result.value,
      params,
    });

    return {
      triNation: result.value,
      cachedAt: new Date().toISOString(),
      fromCache: false,
    };
  };
}
