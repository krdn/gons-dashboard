import "server-only";
import {
  TRANSFORM_PRESET_IDS,
  TRANSFORM_PRESET_LABELS,
  type MemoTransformPreset,
} from "@/entities/memo/server";
import { getPresetBySlug, listPresetsByUser } from "@/entities/memo/server";
import { TRANSFORM_PRESETS } from "./preset-meta";
import { PRESET_INSTRUCTIONS } from "./prompts";
import type { PresetCatalogEntry } from "./catalog-types";

export interface ResolvedPreset {
  slug: string;
  label: string;
  instruction: string;
  fidelityGuard: boolean;
  minInputLen: number;
  strictPreserve: boolean;
  isBuiltin: boolean;
  isOverridden: boolean;
}

const BUILTIN = TRANSFORM_PRESET_IDS as readonly string[];

/** 순수 병합 — 빌트인 고정순 + 커스텀(rows 순서 유지). */
export function mergePresetCatalog(rows: MemoTransformPreset[]): PresetCatalogEntry[] {
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const builtins = TRANSFORM_PRESET_IDS.map((slug): PresetCatalogEntry => {
    const ov = bySlug.get(slug);
    return {
      slug,
      label: TRANSFORM_PRESET_LABELS[slug],
      instruction: ov?.instruction ?? PRESET_INSTRUCTIONS[slug],
      defaultInstruction: PRESET_INSTRUCTIONS[slug],
      fidelityGuard: ov?.fidelityGuard ?? true,
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
        minInputLen: 1,
        isBuiltin: false,
        isOverridden: false,
      }),
    );
  return [...builtins, ...customs];
}

export async function listPresetCatalog(userId: string): Promise<PresetCatalogEntry[]> {
  return mergePresetCatalog(await listPresetsByUser(userId));
}

export async function resolvePreset(userId: string, slug: string): Promise<ResolvedPreset | null> {
  const isBuiltin = BUILTIN.includes(slug);
  const row = await getPresetBySlug(userId, slug);
  if (isBuiltin) {
    const id = slug as (typeof TRANSFORM_PRESET_IDS)[number];
    return {
      slug,
      label: TRANSFORM_PRESET_LABELS[id],
      instruction: row?.instruction ?? PRESET_INSTRUCTIONS[id],
      fidelityGuard: row?.fidelityGuard ?? true,
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
    minInputLen: 1,
    strictPreserve: false,
    isBuiltin: false,
    isOverridden: false,
  };
}
