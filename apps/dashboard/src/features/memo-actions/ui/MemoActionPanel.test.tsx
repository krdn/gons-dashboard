// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, fireEvent, screen, act } from "@testing-library/react";
import type { MemoActionItem } from "@/entities/memo/client";

const updateMock = vi.hoisted(() => vi.fn());
vi.mock("../client", () => ({
  updateActionItemStatusAction: (...a: unknown[]) => updateMock(...a),
}));

import { MemoActionPanel } from "./MemoActionPanel";

function item(over: Partial<MemoActionItem>): MemoActionItem {
  return {
    id: "a1",
    memoId: "m1",
    userId: "u1",
    kind: "todo",
    title: "위약금 문의",
    dueAt: null,
    allDay: false,
    status: "proposed",
    remindedAt: null,
    createdAt: new Date("2026-07-12T10:00:00"),
    updatedAt: new Date("2026-07-12T10:00:00"),
    ...over,
  } as MemoActionItem;
}

beforeEach(() => {
  updateMock.mockReset().mockResolvedValue({ kind: "ok" });
});
afterEach(cleanup);

describe("MemoActionPanel", () => {
  it("빈 목록은 아무것도 렌더하지 않는다", () => {
    const { container } = render(<MemoActionPanel items={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("proposed — 제안 라벨·기한과 수락/무시 버튼", () => {
    render(
      <MemoActionPanel
        items={[item({ dueAt: new Date(2026, 6, 15, 14, 0) })]}
      />,
    );
    expect(screen.getByText("→ 할 일 제안")).toBeTruthy();
    expect(screen.getByText("위약금 문의")).toBeTruthy();
    expect(screen.getByText("7/15(수) 14:00")).toBeTruthy();
    expect(screen.getByRole("button", { name: "수락" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "무시" })).toBeTruthy();
  });

  it("수락 클릭 → 액션 호출 (accepted)", async () => {
    render(<MemoActionPanel items={[item({})]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "수락" }));
      await Promise.resolve();
    });
    expect(updateMock).toHaveBeenCalledWith("a1", "accepted");
  });

  it("무시 클릭 → dismissed 전이 (proposed·accepted 양쪽 배선)", async () => {
    render(<MemoActionPanel items={[item({})]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "무시" }));
      await Promise.resolve();
    });
    expect(updateMock).toHaveBeenCalledWith("a1", "dismissed");

    cleanup();
    updateMock.mockClear();
    render(<MemoActionPanel items={[item({ status: "accepted" })]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "무시" }));
      await Promise.resolve();
    });
    expect(updateMock).toHaveBeenCalledWith("a1", "dismissed");
  });

  it("accepted — 완료 버튼이 done 전이를 호출", async () => {
    render(<MemoActionPanel items={[item({ status: "accepted" })]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "위약금 문의 완료" }));
      await Promise.resolve();
    });
    expect(updateMock).toHaveBeenCalledWith("a1", "done");
  });

  it("실패 시 에러 문구를 보여준다", async () => {
    updateMock.mockResolvedValue({ kind: "failed" });
    render(<MemoActionPanel items={[item({})]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "수락" }));
      await Promise.resolve();
    });
    expect(screen.getByText("처리에 실패했습니다 — 다시 시도해 주세요.")).toBeTruthy();
  });
});
