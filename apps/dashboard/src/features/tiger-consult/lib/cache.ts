import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  playmcpAnalysis,
  playmcpYearly,
  playmcpDaily,
  playmcpCompatibility,
} from "@/shared/lib/db/schema";
import { PlayMCPCrossTalkDetectedError } from "./errors";
import type { ValidationResult } from "./validate";

interface CacheFetchInput<T> {
  profileId: string;
  inputHash: string;
  fetcher: () => Promise<T>;
  validator: (payload: T) => ValidationResult;
  tool: string;
}

interface CacheResult<T> {
  payload: T;
  fromCache: boolean;
}

export async function getOrFetchAnalysis<T>(input: CacheFetchInput<T>): Promise<CacheResult<T>> {
  const existing = await db
    .select()
    .from(playmcpAnalysis)
    .where(eq(playmcpAnalysis.profileId, input.profileId))
    .limit(1);
  if (existing[0] && existing[0].inputHash === input.inputHash) {
    return { payload: existing[0].payload as T, fromCache: true };
  }
  const fresh = await callValidated(input);
  await db
    .insert(playmcpAnalysis)
    .values({
      profileId: input.profileId,
      inputHash: input.inputHash,
      payload: fresh as unknown as object,
      validatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: playmcpAnalysis.profileId,
      set: {
        inputHash: input.inputHash,
        payload: fresh as unknown as object,
        validatedAt: new Date(),
      },
    });
  return { payload: fresh, fromCache: false };
}

interface YearlyInput<T> extends CacheFetchInput<T> {
  year: number;
}

export async function getOrFetchYearly<T>(input: YearlyInput<T>): Promise<CacheResult<T>> {
  const existing = await db
    .select()
    .from(playmcpYearly)
    .where(and(eq(playmcpYearly.profileId, input.profileId), eq(playmcpYearly.year, input.year)))
    .limit(1);
  if (existing[0] && existing[0].inputHash === input.inputHash) {
    return { payload: existing[0].payload as T, fromCache: true };
  }
  const fresh = await callValidated(input);
  await db
    .insert(playmcpYearly)
    .values({
      profileId: input.profileId,
      year: input.year,
      inputHash: input.inputHash,
      payload: fresh as unknown as object,
      validatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [playmcpYearly.profileId, playmcpYearly.year],
      set: { inputHash: input.inputHash, payload: fresh as unknown as object, validatedAt: new Date() },
    });
  return { payload: fresh, fromCache: false };
}

interface DailyInput<T> extends CacheFetchInput<T> {
  forDateKst: string;
}

export async function getOrFetchDaily<T>(input: DailyInput<T>): Promise<CacheResult<T>> {
  const existing = await db
    .select()
    .from(playmcpDaily)
    .where(
      and(
        eq(playmcpDaily.profileId, input.profileId),
        eq(playmcpDaily.forDateKst, input.forDateKst),
      ),
    )
    .limit(1);
  if (existing[0] && existing[0].inputHash === input.inputHash) {
    return { payload: existing[0].payload as T, fromCache: true };
  }
  const fresh = await callValidated(input);
  await db
    .insert(playmcpDaily)
    .values({
      profileId: input.profileId,
      forDateKst: input.forDateKst,
      inputHash: input.inputHash,
      payload: fresh as unknown as object,
      validatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [playmcpDaily.profileId, playmcpDaily.forDateKst],
      set: { inputHash: input.inputHash, payload: fresh as unknown as object, validatedAt: new Date() },
    });
  return { payload: fresh, fromCache: false };
}

interface CompatInput<T> {
  profile1Id: string;
  profile2Id: string;
  inputHash1: string;
  inputHash2: string;
  pairHash: string;
  fetcher: () => Promise<T>;
  validator: (payload: T) => ValidationResult;
  tool: string;
}

export async function getOrFetchCompatibility<T>(input: CompatInput<T>): Promise<CacheResult<T>> {
  if (input.profile1Id >= input.profile2Id) {
    throw new Error("getOrFetchCompatibility: profile1Id must be < profile2Id");
  }
  const existing = await db
    .select()
    .from(playmcpCompatibility)
    .where(
      and(
        eq(playmcpCompatibility.profile1Id, input.profile1Id),
        eq(playmcpCompatibility.profile2Id, input.profile2Id),
      ),
    )
    .limit(1);
  if (existing[0] && existing[0].inputHash1 === input.inputHash1 && existing[0].inputHash2 === input.inputHash2) {
    return { payload: existing[0].payload as T, fromCache: true };
  }
  const fresh = await callValidatedForCompat(input);
  await db
    .insert(playmcpCompatibility)
    .values({
      profile1Id: input.profile1Id,
      profile2Id: input.profile2Id,
      inputHash1: input.inputHash1,
      inputHash2: input.inputHash2,
      payload: fresh as unknown as object,
      validatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [playmcpCompatibility.profile1Id, playmcpCompatibility.profile2Id],
      set: {
        inputHash1: input.inputHash1,
        inputHash2: input.inputHash2,
        payload: fresh as unknown as object,
        validatedAt: new Date(),
      },
    });
  return { payload: fresh, fromCache: false };
}

async function callValidated<T>(input: CacheFetchInput<T>): Promise<T> {
  const fresh = await input.fetcher();
  const result = input.validator(fresh);
  if (!result.ok) {
    throw new PlayMCPCrossTalkDetectedError(result.reason, input.tool, input.profileId);
  }
  return fresh;
}

async function callValidatedForCompat<T>(input: CompatInput<T>): Promise<T> {
  const fresh = await input.fetcher();
  const result = input.validator(fresh);
  if (!result.ok) {
    throw new PlayMCPCrossTalkDetectedError(
      result.reason,
      input.tool,
      `${input.profile1Id}+${input.profile2Id}`,
    );
  }
  return fresh;
}
