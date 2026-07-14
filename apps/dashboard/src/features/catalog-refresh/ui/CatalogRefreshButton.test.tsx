// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";

// Server Action 을 mock — 실제 spawn 없이 결과만 주입.
const mockRefresh = vi.fn();
vi.mock("../client", () => ({
  refreshCatalog: (...args: unknown[]) => mockRefresh(...args),
}));

import { CatalogRefreshButton } from "./CatalogRefreshButton";

describe("CatalogRefreshButton", () => {
  beforeEach(() => {
    mockRefresh.mockReset();
  });

  afterEach(cleanup);

  it("클릭하면 kind 로 refreshCatalog 를 호출하고 개수·경고를 표시한다", async () => {
    mockRefresh.mockResolvedValue({
      ok: true,
      count: 38,
      warning: "커밋 전 git diff 로 확인하세요.",
    });
    render(<CatalogRefreshButton kind="skills" />);

    fireEvent.click(screen.getByRole("button", { name: /새로고침|재생성/ }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledWith("skills"));
    expect(await screen.findByText(/38개/)).toBeTruthy();
    expect(screen.getByText(/git diff/)).toBeTruthy();
  });

  it("실패하면 에러 메시지를 표시한다", async () => {
    mockRefresh.mockResolvedValue({ ok: false, error: "스냅샷이 실패했습니다 (exit 1)." });
    render(<CatalogRefreshButton kind="plugins" />);

    fireEvent.click(screen.getByRole("button", { name: /새로고침|재생성/ }));

    expect(await screen.findByText(/실패했습니다/)).toBeTruthy();
  });
});
