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
      summary: { issues: 12, pulls: 3, runs: 5, skipped: false, lockBusy: false, failed: [] },
    });
    render(<RefreshButton />);

    fireEvent.click(screen.getByRole("button", { name: /새로고침/ }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(routerRefreshMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/갱신 완료/)).toBeTruthy();
  });

  it("부분 실패(failed 비어있지 않음)는 경고 문구로 실패 소스를 표시한다", async () => {
    refreshMock.mockResolvedValue({
      ok: true,
      summary: { issues: 0, pulls: 3, runs: 5, skipped: false, lockBusy: false, failed: ["이슈", "Actions"] },
    });
    render(<RefreshButton />);

    fireEvent.click(screen.getByRole("button", { name: /새로고침/ }));

    // 실패 소스가 문구에 노출되고, "갱신 완료" 로만 오인 표시되지 않는다.
    expect(await screen.findByText(/이슈.*Actions|일부/)).toBeTruthy();
    // 부분 실패여도 화면 갱신은 한다(성공한 소스는 반영해야 함).
    await waitFor(() => expect(routerRefreshMock).toHaveBeenCalledTimes(1));
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
