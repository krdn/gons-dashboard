// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { EMAIL_SETTINGS_DEFAULTS } from "@/entities/email-settings/client";

const { catalogActionMock } = vi.hoisted(() => ({
  catalogActionMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("../api/replyModelCatalogAction", () => ({
  replyModelCatalogAction: catalogActionMock,
}));
vi.mock("../api/updateEmailSettings", () => ({
  updateEmailSettings: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../api/syncNowAction", () => ({
  syncNowAction: vi.fn(async () => ({ ok: true, classified: 0 })),
}));
vi.mock("../api/reclassifyAction", () => ({
  reclassifyAction: vi.fn(async () => ({ ok: true, classified: 0 })),
}));

import { EmailSettingsForm } from "./EmailSettingsForm";

const initial = {
  ...EMAIL_SETTINGS_DEFAULTS,
  replyModel: "gemini" as const,
  replyModelId: "gemini-old-pro",
};

function catalogData(source: "live" | "fallback") {
  return {
    defaults: {
      gemini: "gemini-2.5-pro",
      codex: "gpt-5.5",
      claude: "claude-opus-4-8",
    },
    snapshot: {
      source,
      catalog: {
        gemini: ["gemini-2.5-pro"],
        codex: ["gpt-5.5"],
        claude: ["claude-opus-4-8"],
      },
    },
  } as const;
}

beforeEach(() => catalogActionMock.mockReset());
afterEach(cleanup);

describe("EmailSettingsForm model catalog", () => {
  it("live 목록에서 사라진 저장 모델을 사용 불가로 표시한다", async () => {
    catalogActionMock.mockResolvedValue(catalogData("live"));
    render(<EmailSettingsForm initial={initial} onDone={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "현재 프록시의 사용 가능 목록",
    );
  });

  it("fallback에서는 저장 모델을 사용 불가로 단정하지 않고 순서를 보존한다", async () => {
    catalogActionMock.mockResolvedValue(catalogData("fallback"));
    render(<EmailSettingsForm initial={initial} onDone={vi.fn()} />);
    await waitFor(() => expect(catalogActionMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/현재 프록시의 사용 가능 목록/)).toBeNull();
    const provider = screen.getByLabelText("답장 AI 공급사");
    expect(
      within(provider)
        .getAllByRole("option")
        .map((option) => (option as HTMLOptionElement).value),
    ).toEqual(["gemini", "codex", "claude"]);
  });
});
