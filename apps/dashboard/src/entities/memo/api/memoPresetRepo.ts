import "server-only";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { memoTransformPresets } from "@/shared/lib/db/schema";
import { TRANSFORM_PRESET_IDS } from "../model/types";
import type { MemoTransformPreset } from "../model/types";

export interface UpsertPresetInput {
  userId: string;
  slug: string;
  label: string;
  instruction: string;
  fidelityGuard: boolean;
}

export async function listPresetsByUser(userId: string): Promise<MemoTransformPreset[]> {
  return db
    .select()
    .from(memoTransformPresets)
    .where(eq(memoTransformPresets.userId, userId))
    .orderBy(memoTransformPresets.createdAt);
}

export async function getPresetBySlug(
  userId: string,
  slug: string,
): Promise<MemoTransformPreset | null> {
  const rows = await db
    .select()
    .from(memoTransformPresets)
    .where(and(eq(memoTransformPresets.userId, userId), eq(memoTransformPresets.slug, slug)))
    .limit(1);
  return rows[0] ?? null;
}

/** override 저장 — 같은 (user, slug)면 교체. */
export async function upsertPreset(input: UpsertPresetInput): Promise<MemoTransformPreset> {
  const rows = await db
    .insert(memoTransformPresets)
    .values(input)
    .onConflictDoUpdate({
      target: [memoTransformPresets.userId, memoTransformPresets.slug],
      set: {
        label: input.label,
        instruction: input.instruction,
        fidelityGuard: input.fidelityGuard,
        updatedAt: new Date(),
      },
    })
    .returning();
  return rows[0];
}

/** 커스텀 생성 — slug 충돌이면 throw (호출자가 slug 재생성 재시도). */
export async function insertPreset(input: UpsertPresetInput): Promise<MemoTransformPreset> {
  const rows = await db.insert(memoTransformPresets).values(input).returning();
  return rows[0];
}

export async function deletePresetBySlug(userId: string, slug: string): Promise<boolean> {
  const rows = await db
    .delete(memoTransformPresets)
    .where(and(eq(memoTransformPresets.userId, userId), eq(memoTransformPresets.slug, slug)))
    .returning({ id: memoTransformPresets.id });
  return rows.length > 0;
}

export async function countCustomPresets(userId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(memoTransformPresets)
    .where(
      and(
        eq(memoTransformPresets.userId, userId),
        notInArray(memoTransformPresets.slug, [...TRANSFORM_PRESET_IDS]),
      ),
    );
  return rows[0]?.n ?? 0;
}
