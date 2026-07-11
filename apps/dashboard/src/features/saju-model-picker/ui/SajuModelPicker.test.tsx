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

beforeEach(() => replaceMock.mockClear());
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
