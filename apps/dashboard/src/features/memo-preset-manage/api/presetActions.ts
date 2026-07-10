"use server";
import "server-only";
import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import {
  countCustomPresets,
  deletePresetBySlug,
  getPresetBySlug,
  insertPreset,
  upsertPreset,
  upsertDefaultMemoModel,
  TRANSFORM_PRESET_IDS,
  TRANSFORM_PRESET_LABELS,
} from "@/entities/memo/server";
import { PRESET_INSTRUCTIONS } from "@/features/memo-transform/lib/prompts";
import {
  MAX_CUSTOM_PRESETS,
  MemoModelSelectionInput,
  PresetFieldsInput,
} from "./_schema";

const BUILTIN = TRANSFORM_PRESET_IDS as readonly string[];

function revalidate() {
  revalidatePath("/memos");
  revalidatePath("/memos/settings");
}

export type PresetActionResult =
  | { kind: "ok" }
  | { kind: "invalid" }
  | { kind: "limit-exceeded" }
  | { kind: "failed" };

export type CreatePresetResult =
  | { kind: "ok"; slug: string }
  | { kind: "invalid" }
  | { kind: "limit-exceeded" }
  | { kind: "failed" };

export type ModelSettingActionResult =
  | { kind: "ok" }
  | { kind: "invalid" }
  | { kind: "failed" };

/** 빌트인: 기본값과 동일하면 override 삭제(기본값 복귀), 아니면 upsert(라벨은 코드 강제). 커스텀: 기존 행 있을 때만 upsert. */
export async function savePresetAction(
  slug: string,
  input: unknown,
): Promise<PresetActionResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const parsed = PresetFieldsInput.safeParse(input);
  if (!parsed.success) return { kind: "invalid" };

  const isBuiltin = BUILTIN.includes(slug);
  try {
    if (isBuiltin) {
      const id = slug as (typeof TRANSFORM_PRESET_IDS)[number];
      const isDefault =
        parsed.data.instruction === PRESET_INSTRUCTIONS[id] &&
        parsed.data.fidelityGuard === true &&
        parsed.data.model === null &&
        parsed.data.modelId === null;
      if (isDefault) {
        // 기본값과 동일한 저장은 override 삭제 = "행 없음=기본값 자동 반영" 불변식 보존.
        await deletePresetBySlug(session.user.id, slug);
      } else {
        await upsertPreset({
          userId: session.user.id,
          slug,
          label: TRANSFORM_PRESET_LABELS[id], // 빌트인 라벨은 코드 강제 (클라이언트 값 무시)
          instruction: parsed.data.instruction,
          fidelityGuard: parsed.data.fidelityGuard,
          model: parsed.data.model,
          modelId: parsed.data.modelId,
        });
      }
    } else {
      const existing = await getPresetBySlug(session.user.id, slug);
      if (!existing) return { kind: "invalid" }; // 커스텀 생성은 createPresetAction 전용
      await upsertPreset({ userId: session.user.id, slug, ...parsed.data });
    }
    revalidate();
    return { kind: "ok" };
  } catch {
    return { kind: "failed" };
  }
}

function generateSlug(): string {
  return `c-${crypto.randomUUID().slice(0, 8)}`;
}

/** 커스텀 프리셋 생성 — 20개 제한, slug 충돌 시 1회 재시도. */
export async function createPresetAction(
  input: unknown,
): Promise<CreatePresetResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const parsed = PresetFieldsInput.safeParse(input);
  if (!parsed.success) return { kind: "invalid" };

  const userId = session.user.id;
  const count = await countCustomPresets(userId);
  if (count >= MAX_CUSTOM_PRESETS) return { kind: "limit-exceeded" };

  const attempt = async (): Promise<CreatePresetResult | null> => {
    const slug = generateSlug();
    try {
      await insertPreset({ userId, slug, ...parsed.data });
      revalidate();
      return { kind: "ok", slug };
    } catch {
      return null;
    }
  };

  try {
    const first = await attempt();
    if (first) return first;
    const retry = await attempt();
    if (retry) return retry;
    return { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}

/** 빌트인 slug만 허용 — override 삭제로 기본값 복귀. */
export async function resetPresetAction(
  slug: string,
): Promise<PresetActionResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  if (!BUILTIN.includes(slug)) return { kind: "invalid" };

  try {
    await deletePresetBySlug(session.user.id, slug);
    revalidate();
    return { kind: "ok" };
  } catch {
    return { kind: "failed" };
  }
}

/** 커스텀 slug만 허용 — 빌트인은 삭제 불가(reset만 가능). */
export async function deletePresetAction(
  slug: string,
): Promise<PresetActionResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  if (BUILTIN.includes(slug)) return { kind: "invalid" };

  try {
    await deletePresetBySlug(session.user.id, slug);
    revalidate();
    return { kind: "ok" };
  } catch {
    return { kind: "failed" };
  }
}

/** 전체 기본 모델 저장 — 프리셋의 model=null 선택이 이 값을 상속한다. */
export async function saveDefaultMemoModelAction(
  input: unknown,
): Promise<ModelSettingActionResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const parsed = MemoModelSelectionInput.safeParse(input);
  if (!parsed.success) return { kind: "invalid" };

  try {
    await upsertDefaultMemoModel(
      session.user.id,
      parsed.data.model,
      parsed.data.modelId,
    );
    revalidate();
    return { kind: "ok" };
  } catch {
    return { kind: "failed" };
  }
}
