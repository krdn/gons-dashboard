import "server-only";
import {
  TRANSFORM_PRESET_IDS,
  TRANSFORM_PRESET_LABELS,
  getDefaultMemoModel,
  type MemoTransformPreset,
  type MemoModelKey,
} from "@/entities/memo/server";
import { getPresetBySlug, listPresetsByUser } from "@/entities/memo/server";
import { TRANSFORM_PRESETS } from "./preset-meta";
import { PRESET_INSTRUCTIONS } from "./prompts";
import { resolveMemoModelSelection } from "./model-registry";
import type { PresetCatalogEntry } from "./catalog-types";

export interface ResolvedPreset {
  slug: string;
  label: string;
  instruction: string;
  fidelityGuard: boolean;
  model: MemoModelKey;
  modelId: string;
  minInputLen: number;
  strictPreserve: boolean;
  isBuiltin: boolean;
  isOverridden: boolean;
}

const BUILTIN = TRANSFORM_PRESET_IDS as readonly string[];

/** 순수 병합 — 빌트인 고정순 + 커스텀(rows 순서 유지). */
export function mergePresetCatalog(
  rows: MemoTransformPreset[],
): PresetCatalogEntry[] {
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const builtins = TRANSFORM_PRESET_IDS.map((slug): PresetCatalogEntry => {
    const ov = bySlug.get(slug);
    return {
      slug,
      label: TRANSFORM_PRESET_LABELS[slug],
      instruction: ov?.instruction ?? PRESET_INSTRUCTIONS[slug],
      defaultInstruction: PRESET_INSTRUCTIONS[slug],
      fidelityGuard: ov?.fidelityGuard ?? true,
      model: ov?.model ?? null,
      modelId: ov?.modelId ?? null,
      minInputLen: TRANSFORM_PRESETS[slug].minInputLen,
      isBuiltin: true,
      isOverridden: ov !== undefined,
    };
  });
  const customs = rows
    .filter((r) => !BUILTIN.includes(r.slug))
    .map(
      (r): PresetCatalogEntry => ({
        slug: r.slug,
        label: r.label,
        instruction: r.instruction,
        defaultInstruction: null,
        fidelityGuard: r.fidelityGuard,
        model: r.model,
        modelId: r.modelId,
        minInputLen: 1,
        isBuiltin: false,
        isOverridden: false,
      }),
    );
  return [...builtins, ...customs];
}

export async function listPresetCatalog(
  userId: string,
): Promise<PresetCatalogEntry[]> {
  return mergePresetCatalog(await listPresetsByUser(userId));
}

export async function resolvePreset(
  userId: string,
  slug: string,
): Promise<ResolvedPreset | null> {
  const isBuiltin = BUILTIN.includes(slug);
  const [row, storedDefault] = await Promise.all([
    getPresetBySlug(userId, slug),
    getDefaultMemoModel(userId),
  ]);
  const defaultModel = resolveMemoModelSelection(
    storedDefault.model,
    storedDefault.modelId,
  );
  if (isBuiltin) {
    const id = slug as (typeof TRANSFORM_PRESET_IDS)[number];
    return {
      slug,
      label: TRANSFORM_PRESET_LABELS[id],
      instruction: row?.instruction ?? PRESET_INSTRUCTIONS[id],
      fidelityGuard: row?.fidelityGuard ?? true,
      ...(row?.model
        ? resolveMemoModelSelection(row.model, row.modelId)
        : defaultModel),
      minInputLen: TRANSFORM_PRESETS[id].minInputLen,
      strictPreserve: TRANSFORM_PRESETS[id].strictPreserve,
      isBuiltin: true,
      isOverridden: row !== null,
    };
  }
  if (!row) return null;
  return {
    slug,
    label: row.label,
    instruction: row.instruction,
    fidelityGuard: row.fidelityGuard,
    ...(row.model
      ? resolveMemoModelSelection(row.model, row.modelId)
      : defaultModel),
    minInputLen: 1,
    strictPreserve: false,
    isBuiltin: false,
    isOverridden: false,
  };
}

export async function resolveDefaultMemoModel(
  userId: string,
): Promise<{ model: MemoModelKey; modelId: string }> {
  const stored = await getDefaultMemoModel(userId);
  return resolveMemoModelSelection(stored.model, stored.modelId);
}
