// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { PresetCatalogEntry } from "@/features/memo-transform/client";

vi.mock("../client", () => ({
  savePresetAction: vi.fn(async () => ({ kind: "ok" })),
  createPresetAction: vi.fn(async () => ({ kind: "ok", slug: "c-new1234" })),
  resetPresetAction: vi.fn(async () => ({ kind: "ok" })),
  deletePresetAction: vi.fn(async () => ({ kind: "ok" })),
  previewPresetAction: vi.fn(async () => ({ kind: "ok", content: "미리보기 결과" })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { PresetSettings } from "./PresetSettings";

function makeCatalog(): PresetCatalogEntry[] {
  const builtinSlugs = ["summary", "todo", "diary", "report", "sns", "email", "outline"];
  const builtins: PresetCatalogEntry[] = builtinSlugs.map((slug, i) => ({
    slug,
    label: `기본프리셋${i}`,
    instruction: `기본 지시문 ${i}`,
    defaultInstruction: `기본 지시문 ${i}`,
    fidelityGuard: true,
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
    minInputLen: 1,
    isBuiltin: false,
    isOverridden: false,
  };
  return [...builtins, custom];
}

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PresetSettings", () => {
  it("카탈로그 렌더 시 섹션 2개와 배지(기본 6·수정됨 1·커스텀 1)가 보인다", () => {
    render(<PresetSettings catalog={makeCatalog()} />);

    expect(screen.getByText("기본 프리셋")).toBeTruthy();
    expect(screen.getByText("내 프리셋")).toBeTruthy();

    expect(screen.getAllByText("기본")).toHaveLength(6);
    expect(screen.getAllByText("수정됨")).toHaveLength(1);
    expect(screen.getAllByText("커스텀")).toHaveLength(1);
  });

  it("항목 클릭 시 편집기에 해당 instruction이 표시된다", () => {
    render(<PresetSettings catalog={makeCatalog()} />);

    fireEvent.click(screen.getByRole("button", { name: /내 커스텀/ }));

    const editor = screen.getByRole("region", { name: "프리셋 편집" });
    expect(within(editor).getByDisplayValue("커스텀 지시문")).toBeTruthy();
  });

  it("instruction 수정 후 다른 항목 클릭 시 confirm이 호출된다", () => {
    render(<PresetSettings catalog={makeCatalog()} />);

    fireEvent.click(screen.getByRole("button", { name: /내 커스텀/ }));
    const editor = screen.getByRole("region", { name: "프리셋 편집" });
    const textarea = within(editor).getByDisplayValue("커스텀 지시문");
    fireEvent.change(textarea, { target: { value: "커스텀 지시문 수정됨" } });

    const confirmSpy = window.confirm as unknown as ReturnType<typeof vi.fn>;
    expect(confirmSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /기본프리셋1/ }));

    expect(confirmSpy).toHaveBeenCalledWith("저장하지 않은 변경이 있습니다. 이동할까요?");
  });

  it("커스텀 선택 시 삭제 버튼이 보이고, 빌트인 선택 시 보이지 않는다", () => {
    render(<PresetSettings catalog={makeCatalog()} />);

    fireEvent.click(screen.getByRole("button", { name: /내 커스텀/ }));
    let editor = screen.getByRole("region", { name: "프리셋 편집" });
    expect(within(editor).getByRole("button", { name: "삭제" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /기본프리셋1/ }));
    editor = screen.getByRole("region", { name: "프리셋 편집" });
    expect(within(editor).queryByRole("button", { name: "삭제" })).toBeNull();
  });

  it("+ 새 프리셋 클릭 시 빈 편집기가 열리고 라벨을 입력할 수 있다", () => {
    render(<PresetSettings catalog={makeCatalog()} />);

    fireEvent.click(screen.getByRole("button", { name: "+ 새 프리셋" }));

    const editor = screen.getByRole("region", { name: "프리셋 편집" });
    const labelInput = within(editor).getByLabelText("라벨") as HTMLInputElement;
    expect(labelInput.value).toBe("");

    fireEvent.change(labelInput, { target: { value: "새 프리셋 이름" } });
    expect(labelInput.value).toBe("새 프리셋 이름");
  });
});
