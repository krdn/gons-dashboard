// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
const routerRefreshMock = vi.fn();

vi.mock("../client", () => ({
  refreshGithubMonitor: () => refreshMock(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefreshMock }),
}));

import { RefreshButton } from "./RefreshButton";

beforeEach(() => {
  refreshMock.mockReset();
  routerRefreshMock.mockReset();
});

afterEach(cleanup);

describe("RefreshButton", () => {
  it("클릭 시 refreshGithubMonitor 를 호출하고 성공하면 router.refresh 한다", async () => {
    refreshMock.mockResolvedValue({
      ok: true,
      summary: { issues: 12, pulls: 3, runs: 5, skipped: false, lockBusy: false },
    });
    render(<RefreshButton />);

    fireEvent.click(screen.getByRole("button", { name: /새로고침/ }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(routerRefreshMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/갱신 완료/)).toBeTruthy();
  });

  it("쿨다운 거부 시 에러 메시지를 표시하고 router.refresh 하지 않는다", async () => {
    refreshMock.mockResolvedValue({
      ok: false,
      error: "잠시 후 다시 시도하세요 (25초 남음)",
      cooldownSec: 25,
    });
    render(<RefreshButton />);

    fireEvent.click(screen.getByRole("button", { name: /새로고침/ }));

    expect(await screen.findByText(/25초 남음/)).toBeTruthy();
    expect(routerRefreshMock).not.toHaveBeenCalled();
  });
});
