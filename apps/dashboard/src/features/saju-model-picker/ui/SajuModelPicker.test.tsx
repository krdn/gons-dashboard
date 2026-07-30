// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { replaceMock, searchParamsState } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  searchParamsState: { value: "" },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => new URLSearchParams(searchParamsState.value),
}));

import { SajuModelPicker } from "./SajuModelPicker";

function renderPickerWithSearchParams(value: string) {
  searchParamsState.value = value;
  return render(
    <SajuModelPicker
      selected="claude"
      selectedModelId="claude-opus-4-8"
      snapshot={{
        source: "live",
        catalog: {
          claude: ["claude-opus-4-8", "claude-sonnet-5"],
          codex: ["gpt-5.5"],
          gemini: ["gemini-2.5-pro"],
        },
      }}
    />,
  );
}

beforeEach(() => {
  replaceMock.mockClear();
  document.cookie = "saju_model=; path=/; max-age=0";
});
afterEach(cleanup);

describe("SajuModelPicker", () => {
  it("live 목록에서 사라진 모델을 사용 불가로 표시한다", () => {
    render(
      <SajuModelPicker
        selected="claude"
        selectedModelId="claude-opus-3"
        snapshot={{
          source: "live",
          catalog: { claude: ["claude-opus-4-8"], codex: [], gemini: [] },
        }}
      />,
    );
    expect(screen.getByText(/claude-opus-3 \(현재 사용 불가\)/)).toBeTruthy();
  });

  it("fallback에서는 확인 불가 모델을 사용 불가로 단정하지 않는다", () => {
    render(
      <SajuModelPicker
        selected="claude"
        selectedModelId="claude-opus-3"
        snapshot={{
          source: "fallback",
          catalog: { claude: ["claude-opus-4-8"], codex: [], gemini: [] },
        }}
      />,
    );
    expect(screen.queryByText(/현재 사용 불가/)).toBeNull();
  });

  it("fallback이어도 선택한 모델을 옵션으로 유지한다", () => {
    // 옵션이 없으면 브라우저가 첫 옵션(기본 모델)을 대신 표시해
    // 선택이 풀린 것처럼 보인다 — 실제 호출 모델과 어긋나는 상태.
    render(
      <SajuModelPicker
        selected="claude"
        selectedModelId="claude-opus-5"
        snapshot={{
          source: "fallback",
          catalog: { claude: ["claude-opus-4-8"], codex: [], gemini: [] },
        }}
      />,
    );
    const select = screen.getByLabelText("상세 모델") as HTMLSelectElement;
    expect(select.value).toBe("claude-opus-5");
    expect(screen.getByText(/claude-opus-5 \(목록 확인 불가\)/)).toBeTruthy();
  });

  it("모델 변경 시 선택을 쿠키에 기록한다", () => {
    renderPickerWithSearchParams("");
    fireEvent.change(screen.getByLabelText("상세 모델"), {
      target: { value: "claude-sonnet-5" },
    });
    expect(document.cookie).toContain("saju_model=claude|claude-sonnet-5");
  });

  it("공급사 변경 시 모델 ID 없이 공급사만 쿠키에 기록한다", () => {
    renderPickerWithSearchParams("");
    fireEvent.change(screen.getByLabelText("AI 공급사"), {
      target: { value: "gemini" },
    });
    expect(document.cookie).toContain("saju_model=gemini|");
  });

  it("모델 변경 시 기존 query를 보존하고 model/modelId를 갱신한다", () => {
    renderPickerWithSearchParams("tab=daily");
    fireEvent.change(screen.getByLabelText("상세 모델"), {
      target: { value: "claude-sonnet-5" },
    });
    expect(replaceMock).toHaveBeenCalledWith(
      "?tab=daily&model=claude&modelId=claude-sonnet-5",
      { scroll: false },
    );
  });
});
