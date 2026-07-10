import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TRANSFORM_PRESET_IDS,
  TRANSFORM_PRESET_LABELS,
} from "@/entities/memo/model/types";

const countMock = vi.fn();
const deleteMock = vi.fn();
const getMock = vi.fn();
const insertMock = vi.fn();
const upsertMock = vi.fn();
const upsertDefaultModelMock = vi.fn();
const getDefaultModelMock = vi.fn();
const resolveDefaultModelMock = vi.fn();
const modelAvailabilityMock = vi.fn();
const revalidateMock = vi.fn();
const transformMock = vi.fn();
const authMock = vi.fn(
  async (): Promise<{ user: { id: string } } | null> => ({
    user: { id: "u1" },
  }),
);

vi.mock("@/shared/lib/auth", () => ({ auth: () => authMock() }));
vi.mock("@/entities/memo/server", () => ({
  countCustomPresets: (...a: unknown[]) => countMock(...a),
  deletePresetBySlug: (...a: unknown[]) => deleteMock(...a),
  getPresetBySlug: (...a: unknown[]) => getMock(...a),
  insertPreset: (...a: unknown[]) => insertMock(...a),
  upsertPreset: (...a: unknown[]) => upsertMock(...a),
  upsertDefaultMemoModel: (...a: unknown[]) => upsertDefaultModelMock(...a),
  getDefaultMemoModel: (...a: unknown[]) => getDefaultModelMock(...a),
  TRANSFORM_PRESET_IDS,
  TRANSFORM_PRESET_LABELS,
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidateMock(...a),
}));
vi.mock("@/features/memo-transform/lib/transform-memo", () => ({
  transformMemoContent: (...a: unknown[]) => transformMock(...a),
}));
vi.mock("@/features/memo-transform/lib/preset-resolver", () => ({
  resolveDefaultMemoModel: (...a: unknown[]) => resolveDefaultModelMock(...a),
}));
vi.mock("@/features/memo-transform/lib/model-catalog", () => ({
  isMemoModelCurrentlyAvailable: (...a: unknown[]) =>
    modelAvailabilityMock(...a),
}));

import {
  savePresetAction,
  createPresetAction,
  resetPresetAction,
  deletePresetAction,
  saveDefaultMemoModelAction,
} from "./presetActions";
import { previewPresetAction } from "./previewPresetAction";
import { PRESET_INSTRUCTIONS } from "@/features/memo-transform/lib/prompts";

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ user: { id: "u1" } });
  countMock.mockReset().mockResolvedValue(0);
  deleteMock.mockReset().mockResolvedValue(true);
  getMock.mockReset().mockResolvedValue(null);
  insertMock.mockReset().mockResolvedValue({ id: "p1" });
  upsertMock.mockReset().mockResolvedValue({ id: "p1" });
  upsertDefaultModelMock.mockReset().mockResolvedValue(undefined);
  getDefaultModelMock
    .mockReset()
    .mockResolvedValue({ model: "claude", modelId: null });
  resolveDefaultModelMock
    .mockReset()
    .mockResolvedValue({ model: "claude", modelId: "claude-sonnet-5" });
  modelAvailabilityMock.mockReset().mockResolvedValue(true);
  revalidateMock.mockReset();
  transformMock
    .mockReset()
    .mockResolvedValue({ kind: "ok", content: "변환됨" });
});

describe("savePresetAction", () => {
  it("빌트인 저장(기본값과 다름) → upsert 호출, label은 코드 라벨 강제", async () => {
    const result = await savePresetAction("tidy", {
      label: "무시될라벨",
      instruction: "커스텀 지시사항",
      fidelityGuard: true,
      model: null,
      modelId: null,
    });
    expect(result.kind).toBe("ok");
    expect(upsertMock).toHaveBeenCalledWith({
      userId: "u1",
      slug: "tidy",
      label: TRANSFORM_PRESET_LABELS.tidy,
      instruction: "커스텀 지시사항",
      fidelityGuard: true,
      model: null,
      modelId: null,
    });
    expect(deleteMock).not.toHaveBeenCalled();
    expect(revalidateMock).toHaveBeenCalledWith("/memos");
    expect(revalidateMock).toHaveBeenCalledWith("/memos/settings");
  });

  it("빌트인 저장(기본값과 동일) → delete 호출, upsert 미호출", async () => {
    const result = await savePresetAction("tidy", {
      label: "무시될라벨",
      instruction: PRESET_INSTRUCTIONS.tidy,
      fidelityGuard: true,
    });
    expect(result.kind).toBe("ok");
    expect(deleteMock).toHaveBeenCalledWith("u1", "tidy");
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("빌트인 프롬프트가 기본이어도 모델을 지정하면 override를 보존한다", async () => {
    const result = await savePresetAction("tidy", {
      label: "무시될라벨",
      instruction: PRESET_INSTRUCTIONS.tidy,
      fidelityGuard: true,
      model: "codex",
      modelId: "gpt-5.5",
    });
    expect(result.kind).toBe("ok");
    expect(deleteMock).not.toHaveBeenCalled();
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "tidy", model: "codex" }),
    );
  });

  it("커스텀 저장(행 존재) → upsert", async () => {
    getMock.mockResolvedValue({ id: "p1", slug: "c-abcd1234" });
    const result = await savePresetAction("c-abcd1234", {
      label: "내프리셋",
      instruction: "커스텀 지시",
      fidelityGuard: false,
      model: null,
      modelId: null,
    });
    expect(result.kind).toBe("ok");
    expect(upsertMock).toHaveBeenCalledWith({
      userId: "u1",
      slug: "c-abcd1234",
      label: "내프리셋",
      instruction: "커스텀 지시",
      fidelityGuard: false,
      model: null,
      modelId: null,
    });
  });

  it("커스텀 저장(행 없음) → invalid", async () => {
    getMock.mockResolvedValue(null);
    const result = await savePresetAction("c-abcd1234", {
      label: "내프리셋",
      instruction: "커스텀 지시",
      fidelityGuard: false,
    });
    expect(result.kind).toBe("invalid");
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("공백-only label은 invalid (Zod trim)", async () => {
    const result = await savePresetAction("tidy", {
      label: "   ",
      instruction: "커스텀 지시",
      fidelityGuard: true,
    });
    expect(result.kind).toBe("invalid");
    expect(upsertMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("instruction 2,001자는 invalid (경계값)", async () => {
    const result = await savePresetAction("tidy", {
      label: "라벨",
      instruction: "a".repeat(2001),
      fidelityGuard: true,
    });
    expect(result.kind).toBe("invalid");
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("auth 세션 없음 → throw Unauthorized", async () => {
    authMock.mockResolvedValue(null);
    await expect(
      savePresetAction("tidy", {
        label: "라벨",
        instruction: "지시",
        fidelityGuard: true,
      }),
    ).rejects.toThrow("Unauthorized");
  });
});

describe("saveDefaultMemoModelAction", () => {
  it("유효한 모델 키를 사용자 전체 기본값으로 저장한다", async () => {
    expect(
      await saveDefaultMemoModelAction({
        model: "gemini",
        modelId: "gemini-3.1-pro",
      }),
    ).toEqual({ kind: "ok" });
    expect(upsertDefaultModelMock).toHaveBeenCalledWith(
      "u1",
      "gemini",
      "gemini-3.1-pro",
    );
  });

  it("임의 모델 ID는 거부한다", async () => {
    expect(await saveDefaultMemoModelAction("unknown-model")).toEqual({
      kind: "invalid",
    });
    expect(upsertDefaultModelMock).not.toHaveBeenCalled();
  });

  it("공급사와 상세 모델 ID가 다르면 거부한다", async () => {
    expect(
      await saveDefaultMemoModelAction({
        model: "claude",
        modelId: "gpt-5.5",
      }),
    ).toEqual({ kind: "invalid" });
    expect(upsertDefaultModelMock).not.toHaveBeenCalled();
  });
});

describe("createPresetAction", () => {
  it("20개 초과 → limit-exceeded", async () => {
    countMock.mockResolvedValue(20);
    const result = await createPresetAction({
      label: "새프리셋",
      instruction: "지시",
      fidelityGuard: true,
    });
    expect(result.kind).toBe("limit-exceeded");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("slug 충돌 1회 → 재시도 ok", async () => {
    insertMock
      .mockRejectedValueOnce(new Error("duplicate key"))
      .mockResolvedValueOnce({ id: "p2" });
    const result = await createPresetAction({
      label: "새프리셋",
      instruction: "지시",
      fidelityGuard: true,
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(typeof result.slug).toBe("string");
    }
    expect(insertMock).toHaveBeenCalledTimes(2);
  });
});

describe("resetPresetAction", () => {
  it("커스텀 slug → invalid", async () => {
    const result = await resetPresetAction("c-abcd1234");
    expect(result.kind).toBe("invalid");
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

describe("deletePresetAction", () => {
  it("빌트인 slug → invalid", async () => {
    const result = await deletePresetAction("tidy");
    expect(result.kind).toBe("invalid");
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

describe("previewPresetAction", () => {
  it("auth 세션 없음 → throw Unauthorized", async () => {
    authMock.mockResolvedValue(null);
    await expect(
      previewPresetAction({
        instruction: "지시",
        fidelityGuard: true,
        sampleText: "샘플 텍스트",
      }),
    ).rejects.toThrow("Unauthorized");
  });

  it("정상 → transformMemoContent 호출, revalidatePath 미호출", async () => {
    const result = await previewPresetAction({
      instruction: "지시사항",
      fidelityGuard: true,
      sampleText: "샘플 텍스트입니다",
    });
    expect(result).toEqual({ kind: "ok", content: "변환됨" });
    expect(transformMock).toHaveBeenCalledWith(
      "샘플 텍스트입니다",
      expect.objectContaining({
        slug: "preview",
        label: "미리보기",
        instruction: "지시사항",
        fidelityGuard: true,
        minInputLen: 1,
        strictPreserve: false,
        isBuiltin: false,
        isOverridden: false,
        model: "claude",
        modelId: "claude-sonnet-5",
      }),
    );
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("프리셋에서 지정한 모델은 전체 기본값 대신 미리보기에 사용한다", async () => {
    await previewPresetAction({
      instruction: "지시사항",
      fidelityGuard: true,
      model: "gemini",
      modelId: "gemini-3.1-pro",
      sampleText: "샘플 텍스트입니다",
    });
    expect(transformMock).toHaveBeenCalledWith(
      "샘플 텍스트입니다",
      expect.objectContaining({ model: "gemini", modelId: "gemini-3.1-pro" }),
    );
    expect(resolveDefaultModelMock).not.toHaveBeenCalled();
  });

  it("페이지를 연 뒤 프록시 목록에서 사라진 모델은 LLM 호출 전에 거부한다", async () => {
    modelAvailabilityMock.mockResolvedValue(false);
    await expect(
      previewPresetAction({
        instruction: "지시사항",
        fidelityGuard: true,
        model: "codex",
        modelId: "gpt-5.6-luna",
        sampleText: "샘플 텍스트입니다",
      }),
    ).resolves.toEqual({ kind: "model-unavailable" });
    expect(transformMock).not.toHaveBeenCalled();
  });
});
