import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TRANSFORM_PRESET_IDS,
  TRANSFORM_PRESET_LABELS,
} from "@/entities/memo/model/types";
import type { MemoTransformPreset } from "@/entities/memo/model/types";
import { PRESET_INSTRUCTIONS } from "./prompts";
import { TRANSFORM_PRESETS } from "./preset-meta";

const getPresetBySlugMock = vi.fn();
const listPresetsByUserMock = vi.fn();
const getDefaultMemoModelMock = vi.fn();

vi.mock("@/entities/memo/server", () => ({
  TRANSFORM_PRESET_IDS,
  TRANSFORM_PRESET_LABELS,
  getPresetBySlug: (...a: unknown[]) => getPresetBySlugMock(...a),
  listPresetsByUser: (...a: unknown[]) => listPresetsByUserMock(...a),
  getDefaultMemoModel: (...a: unknown[]) => getDefaultMemoModelMock(...a),
}));
vi.mock("./model-registry", () => ({
  resolveMemoModelSelection: (model: string, modelId: string | null) => ({
    model,
    modelId: modelId ?? `${model}-fallback`,
  }),
}));

const { mergePresetCatalog, resolvePreset } = await import("./preset-resolver");

function makeRow(overrides: Partial<MemoTransformPreset>): MemoTransformPreset {
  return {
    id: "row-id",
    userId: "u1",
    slug: "tidy",
    label: "커스텀 라벨",
    instruction: "커스텀 지시",
    fidelityGuard: true,
    model: null,
    modelId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("mergePresetCatalog", () => {
  it("① 행 없음 → 빌트인 7종 고정순, 전부 미override", () => {
    const result = mergePresetCatalog([]);
    expect(result).toHaveLength(7);
    expect(result.map((r) => r.slug)).toEqual([...TRANSFORM_PRESET_IDS]);
    for (const entry of result) {
      expect(entry.isBuiltin).toBe(true);
      expect(entry.isOverridden).toBe(false);
      expect(entry.instruction).toBe(
        PRESET_INSTRUCTIONS[entry.slug as keyof typeof PRESET_INSTRUCTIONS],
      );
      expect(entry.defaultInstruction).toBe(entry.instruction);
    }
  });

  it("② tidy override 행 → tidy만 override, label은 코드 라벨 유지", () => {
    const overrideRow = makeRow({
      slug: "tidy",
      label: "override 라벨",
      instruction: "override 지시",
      fidelityGuard: false,
    });
    const result = mergePresetCatalog([overrideRow]);
    const tidy = result.find((r) => r.slug === "tidy");
    expect(tidy).toBeDefined();
    expect(tidy?.isOverridden).toBe(true);
    expect(tidy?.instruction).toBe("override 지시");
    expect(tidy?.label).toBe(TRANSFORM_PRESET_LABELS.tidy);
    expect(tidy?.defaultInstruction).toBe(PRESET_INSTRUCTIONS.tidy);

    const others = result.filter((r) => r.slug !== "tidy");
    for (const entry of others) {
      expect(entry.isOverridden).toBe(false);
    }
  });

  it("③ 커스텀 행 2개 → 빌트인 7종 뒤에 입력 순서대로, minInputLen 1, defaultInstruction null", () => {
    const custom1 = makeRow({
      slug: "custom-1",
      label: "커스텀1",
      instruction: "지시1",
    });
    const custom2 = makeRow({
      slug: "custom-2",
      label: "커스텀2",
      instruction: "지시2",
    });
    const result = mergePresetCatalog([custom1, custom2]);
    expect(result).toHaveLength(9);
    expect(result.slice(7).map((r) => r.slug)).toEqual([
      "custom-1",
      "custom-2",
    ]);
    for (const entry of result.slice(7)) {
      expect(entry.isBuiltin).toBe(false);
      expect(entry.defaultInstruction).toBeNull();
      expect(entry.minInputLen).toBe(1);
    }
  });

  it("④ override와 커스텀 혼재 → 총 9개 (7+2)", () => {
    const overrideRow = makeRow({
      slug: "polish",
      label: "무시됨",
      instruction: "override",
    });
    const custom1 = makeRow({ slug: "custom-1", instruction: "지시1" });
    const custom2 = makeRow({ slug: "custom-2", instruction: "지시2" });
    const result = mergePresetCatalog([overrideRow, custom1, custom2]);
    expect(result).toHaveLength(9);
    expect(result.map((r) => r.slug)).toEqual([
      ...TRANSFORM_PRESET_IDS,
      "custom-1",
      "custom-2",
    ]);
  });

  it("⑤ 수동 삽입된 비빌트인 slug(weird-slug)도 커스텀 취급", () => {
    const weird = makeRow({
      slug: "weird-slug",
      label: "이상한거",
      instruction: "지시",
    });
    const result = mergePresetCatalog([weird]);
    expect(result).toHaveLength(8);
    const entry = result.find((r) => r.slug === "weird-slug");
    expect(entry).toBeDefined();
    expect(entry?.isBuiltin).toBe(false);
    expect(entry?.defaultInstruction).toBeNull();
  });
});

describe("resolvePreset", () => {
  beforeEach(() => {
    getPresetBySlugMock.mockReset();
    getDefaultMemoModelMock
      .mockReset()
      .mockResolvedValue({ model: "claude", modelId: "claude-sonnet-5" });
  });

  it("빌트인 미override → 코드 기본 + strictPreserve 코드값", async () => {
    getPresetBySlugMock.mockResolvedValue(null);
    const result = await resolvePreset("u1", "tidy");
    expect(result).not.toBeNull();
    expect(result?.isBuiltin).toBe(true);
    expect(result?.isOverridden).toBe(false);
    expect(result?.instruction).toBe(PRESET_INSTRUCTIONS.tidy);
    expect(result?.minInputLen).toBe(TRANSFORM_PRESETS.tidy.minInputLen);
    expect(result?.strictPreserve).toBe(TRANSFORM_PRESETS.tidy.strictPreserve);
    expect(result?.model).toBe("claude");
    expect(result?.modelId).toBe("claude-sonnet-5");
  });

  it("프리셋 모델 override가 있으면 전체 기본 모델보다 우선한다", async () => {
    getDefaultMemoModelMock.mockResolvedValue({
      model: "gemini",
      modelId: "gemini-pro-latest",
    });
    getPresetBySlugMock.mockResolvedValue(
      makeRow({ slug: "summary", model: "codex", modelId: "gpt-5.4" }),
    );
    const result = await resolvePreset("u1", "summary");
    expect(result?.model).toBe("codex");
    expect(result?.modelId).toBe("gpt-5.4");
  });

  it("빌트인 override → instruction/fidelityGuard는 행 값, 메타·label은 코드 값", async () => {
    const row = makeRow({
      slug: "tidy",
      instruction: "커스텀 지시",
      fidelityGuard: false,
    });
    getPresetBySlugMock.mockResolvedValue(row);
    const result = await resolvePreset("u1", "tidy");
    expect(result).not.toBeNull();
    expect(result?.isBuiltin).toBe(true);
    expect(result?.isOverridden).toBe(true);
    expect(result?.instruction).toBe("커스텀 지시");
    expect(result?.fidelityGuard).toBe(false);
    // 메타 provenance: override 행이 있어도 minInputLen/strictPreserve는 코드 값 유지
    expect(result?.minInputLen).toBe(TRANSFORM_PRESETS.tidy.minInputLen);
    expect(result?.strictPreserve).toBe(TRANSFORM_PRESETS.tidy.strictPreserve);
    expect(result?.label).toBe(TRANSFORM_PRESET_LABELS.tidy);
  });

  it("커스텀 존재 → minInputLen 1, strictPreserve false", async () => {
    const row = makeRow({
      slug: "custom-1",
      label: "커스텀1",
      instruction: "지시1",
    });
    getPresetBySlugMock.mockResolvedValue(row);
    const result = await resolvePreset("u1", "custom-1");
    expect(result).not.toBeNull();
    expect(result?.isBuiltin).toBe(false);
    expect(result?.minInputLen).toBe(1);
    expect(result?.strictPreserve).toBe(false);
    expect(result?.instruction).toBe("지시1");
  });

  it("미존재 slug → null", async () => {
    getPresetBySlugMock.mockResolvedValue(null);
    const result = await resolvePreset("u1", "nope");
    expect(result).toBeNull();
  });
});
