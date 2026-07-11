// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import type { PresetCatalogEntry } from "@/features/memo-transform/client";

vi.mock("../client", () => ({
  savePresetAction: vi.fn(async () => ({ kind: "ok" })),
  createPresetAction: vi.fn(async () => ({ kind: "ok", slug: "c-new1234" })),
  resetPresetAction: vi.fn(async () => ({ kind: "ok" })),
  deletePresetAction: vi.fn(async () => ({ kind: "ok" })),
  previewPresetAction: vi.fn(async () => ({
    kind: "ok",
    content: "미리보기 결과",
  })),
  saveDefaultMemoModelAction: vi.fn(async () => ({ kind: "ok" })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { PresetSettings } from "./PresetSettings";
import { previewPresetAction, saveDefaultMemoModelAction } from "../client";

const MODEL_CATALOG = {
  claude: ["claude-sonnet-5", "claude-opus-4-8"],
  codex: ["gpt-5.5", "gpt-5.4"],
  gemini: ["gemini-pro-latest", "gemini-3.1-pro"],
};
const MODEL_CATALOG_SNAPSHOT = {
  source: "live" as const,
  catalog: MODEL_CATALOG,
};
const DEFAULT_MODEL = { model: "claude", modelId: "claude-sonnet-5" } as const;

function makeCatalog(): PresetCatalogEntry[] {
  const builtinSlugs = [
    "summary",
    "todo",
    "diary",
    "report",
    "sns",
    "email",
    "outline",
  ];
  const builtins: PresetCatalogEntry[] = builtinSlugs.map((slug, i) => ({
    slug,
    label: `기본프리셋${i}`,
    instruction: `기본 지시문 ${i}`,
    defaultInstruction: `기본 지시문 ${i}`,
    fidelityGuard: true,
    model: null,
    modelId: null,
    minInputLen: 10,
    isBuiltin: true,
    isOverridden: false,
  }));
  // 하나는 수정됨 상태로 오버라이드
  builtins[0] = {
    ...builtins[0],
    instruction: "수정된 지시문",
    isOverridden: true,
  };
  const custom: PresetCatalogEntry = {
    slug: "c-abcd1234",
    label: "내 커스텀",
    instruction: "커스텀 지시문",
    defaultInstruction: null,
    fidelityGuard: false,
    model: "gemini",
    modelId: "gemini-3.1-pro",
    minInputLen: 1,
    isBuiltin: false,
    isOverridden: false,
  };
  return [...builtins, custom];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderSettings() {
  return render(
    <PresetSettings
      catalog={makeCatalog()}
      initialDefaultModel={DEFAULT_MODEL}
      modelCatalogSnapshot={MODEL_CATALOG_SNAPSHOT}
    />,
  );
}

describe("PresetSettings", () => {
  it("카탈로그 렌더 시 섹션 2개와 배지(기본 6·수정됨 1·커스텀 1)가 보인다", () => {
    renderSettings();

    expect(screen.getByText("기본 프리셋")).toBeTruthy();
    expect(screen.getByText("내 프리셋")).toBeTruthy();

    expect(screen.getAllByText("기본")).toHaveLength(6);
    expect(screen.getAllByText("수정됨")).toHaveLength(1);
    expect(screen.getAllByText("커스텀")).toHaveLength(1);
  });

  it("항목 클릭 시 편집기에 해당 instruction이 표시된다", () => {
    renderSettings();

    fireEvent.click(screen.getByRole("button", { name: /내 커스텀/ }));

    const editor = screen.getByRole("region", { name: "프리셋 편집" });
    expect(within(editor).getByDisplayValue("커스텀 지시문")).toBeTruthy();
  });

  it("instruction 수정 후 다른 항목 클릭 시 confirm이 호출된다", () => {
    renderSettings();

    fireEvent.click(screen.getByRole("button", { name: /내 커스텀/ }));
    const editor = screen.getByRole("region", { name: "프리셋 편집" });
    const textarea = within(editor).getByDisplayValue("커스텀 지시문");
    fireEvent.change(textarea, { target: { value: "커스텀 지시문 수정됨" } });

    const confirmSpy = window.confirm as unknown as ReturnType<typeof vi.fn>;
    expect(confirmSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /기본프리셋1/ }));

    expect(confirmSpy).toHaveBeenCalledWith(
      "저장하지 않은 변경이 있습니다. 이동할까요?",
    );
  });

  it("커스텀 선택 시 삭제 버튼이 보이고, 빌트인 선택 시 보이지 않는다", () => {
    renderSettings();

    fireEvent.click(screen.getByRole("button", { name: /내 커스텀/ }));
    let editor = screen.getByRole("region", { name: "프리셋 편집" });
    expect(within(editor).getByRole("button", { name: "삭제" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /기본프리셋1/ }));
    editor = screen.getByRole("region", { name: "프리셋 편집" });
    expect(within(editor).queryByRole("button", { name: "삭제" })).toBeNull();
  });

  it("+ 새 프리셋 클릭 시 빈 편집기가 열리고 라벨을 입력할 수 있다", () => {
    renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "+ 새 프리셋" }));

    const editor = screen.getByRole("region", { name: "프리셋 편집" });
    const labelInput = within(editor).getByLabelText(
      "라벨",
    ) as HTMLInputElement;
    expect(labelInput.value).toBe("");

    fireEvent.change(labelInput, { target: { value: "새 프리셋 이름" } });
    expect(labelInput.value).toBe("새 프리셋 이름");
  });

  it("전체 기본 모델 변경을 즉시 저장한다", async () => {
    renderSettings();
    fireEvent.change(screen.getAllByLabelText("AI 공급사")[0], {
      target: { value: "codex" },
    });
    expect(saveDefaultMemoModelAction).toHaveBeenCalledWith({
      model: "codex",
      modelId: "gpt-5.5",
    });
  });

  it("전체 기본값도 공급사 안의 상세 모델을 선택해 저장한다", () => {
    renderSettings();
    fireEvent.change(screen.getAllByLabelText("상세 모델")[0], {
      target: { value: "claude-opus-4-8" },
    });
    expect(saveDefaultMemoModelAction).toHaveBeenCalledWith({
      model: "claude",
      modelId: "claude-opus-4-8",
    });
  });

  it("프리셋 편집기에서 전체 상속 또는 개별 모델을 선택할 수 있다", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: /기본프리셋1/ }));
    const editor = screen.getByRole("region", { name: "프리셋 편집" });
    const selector = within(editor).getByLabelText(
      "AI 공급사",
    ) as HTMLSelectElement;
    expect(selector.value).toBe("inherit");
    fireEvent.change(selector, { target: { value: "gemini" } });
    expect(selector.value).toBe("gemini");
    const detailed = within(editor).getByLabelText(
      "상세 모델",
    ) as HTMLSelectElement;
    expect(detailed.value).toBe("gemini-pro-latest");
    fireEvent.change(detailed, { target: { value: "gemini-3.1-pro" } });
    expect(detailed.value).toBe("gemini-3.1-pro");
  });

  it("상세 모델 드롭다운이 추천 모델 그룹과 선택 근거를 표시한다", () => {
    renderSettings();

    const select = screen.getAllByLabelText("상세 모델")[0] as HTMLSelectElement;
    const groups = Array.from(select.querySelectorAll("optgroup")).map(
      (g) => g.label,
    );
    // 픽스처의 claude 모델 2개가 모두 추천 family(sonnet·opus)라 기타 그룹은 없다.
    expect(groups).toEqual(["추천 모델"]);

    const optionTexts = Array.from(select.options).map((o) => o.textContent);
    expect(optionTexts).toContain(
      "claude-sonnet-5 · 품질·속도 균형 — 기본 추천",
    );
    expect(optionTexts).toContain(
      "claude-opus-4-8 · 최고 품질 — 길고 복잡한 메모",
    );
  });

  it("추천에 없는 모델은 기타 모델 그룹으로 분리된다", () => {
    renderSettings();

    fireEvent.click(screen.getByRole("button", { name: /기본프리셋1/ }));
    const editor = screen.getByRole("region", { name: "프리셋 편집" });
    fireEvent.change(within(editor).getByLabelText("AI 공급사"), {
      target: { value: "gemini" },
    });

    const select = within(editor).getByLabelText(
      "상세 모델",
    ) as HTMLSelectElement;
    const groups = Array.from(select.querySelectorAll("optgroup")).map(
      (g) => g.label,
    );
    // gemini-pro-latest는 pro 규칙이 가져가고, gemini-3.1-pro는 기타로 남는다.
    expect(groups).toEqual(["추천 모델", "기타 모델"]);
    const other = select.querySelectorAll("optgroup")[1];
    expect(
      Array.from(other.querySelectorAll("option")).map((o) => o.value),
    ).toEqual(["gemini-3.1-pro"]);
  });

  it("fallback snapshot에서는 저장 모델을 사용 불가로 단정하지 않는다", () => {
    render(
      <PresetSettings
        catalog={makeCatalog()}
        initialDefaultModel={{ model: "claude", modelId: "claude-opus-3" }}
        modelCatalogSnapshot={{
          source: "fallback",
          catalog: {
            claude: ["claude-sonnet-5"],
            codex: ["gpt-5.5"],
            gemini: ["gemini-pro-latest"],
          },
        }}
      />,
    );
    expect(screen.queryByText(/현재 프록시의 사용 가능 목록/)).toBeNull();
  });

  it("테스트 직전 모델이 사라지면 재선택 안내를 표시한다", async () => {
    vi.mocked(previewPresetAction).mockResolvedValueOnce({
      kind: "model-unavailable",
    });
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: /기본프리셋1/ }));
    fireEvent.click(screen.getByRole("button", { name: "▶ 테스트 실행" }));
    expect(
      await screen.findByText(/모델 목록을 새로고침하거나 다른 모델을 선택/),
    ).toBeTruthy();
  });
});
