// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen, act } from "@testing-library/react";
import type { Memo } from "@/entities/memo/client";

const searchMock = vi.fn();
vi.mock("../client", () => ({
  searchMemosAction: (...a: unknown[]) => searchMock(...a),
}));
// MemoList가 끌고 오는 server action 모듈 차단 (server-only import).
vi.mock("@/features/memo-manage/client", () => ({
  updateMemoAction: vi.fn(),
  deleteMemoAction: vi.fn(),
}));
vi.mock("@/features/memo-transform/client", () => ({
  transformMemoAction: vi.fn(),
  saveTransformationAction: vi.fn(),
}));

import { SearchableMemoList } from "./SearchableMemoList";

function makeMemo(id: string, title: string, cleaned: string): Memo {
  return {
    id,
    userId: "u1",
    source: "text",
    title,
    rawContent: cleaned,
    cleanedContent: cleaned,
    createdAt: new Date("2026-07-10T10:00:00"),
    updatedAt: new Date("2026-07-10T10:00:00"),
  } as Memo;
}

const initial = [makeMemo("m1", "회의 메모", "회의는 세 시"), makeMemo("m2", "장보기", "우유 사기")];

async function typeAndFlush(value: string) {
  fireEvent.change(screen.getByRole("searchbox", { name: "메모 검색" }), {
    target: { value },
  });
  await act(async () => {
    vi.advanceTimersByTime(300);
    // 액션 promise 해소 대기
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  searchMock.mockReset().mockResolvedValue({ kind: "ok", memos: [] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderList() {
  render(<SearchableMemoList memos={initial} transformationsByMemo={{}} presets={[]} />);
}

describe("SearchableMemoList", () => {
  it("빈 쿼리(idle)에는 원본 목록을 보여준다", () => {
    renderList();
    expect(screen.getByText("회의 메모")).toBeTruthy();
    expect(screen.getByText("장보기")).toBeTruthy();
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("디바운스 후 액션을 trim된 쿼리로 1회 호출한다", async () => {
    renderList();
    fireEvent.change(screen.getByRole("searchbox", { name: "메모 검색" }), { target: { value: "회" } });
    fireEvent.change(screen.getByRole("searchbox", { name: "메모 검색" }), { target: { value: " 회의 " } });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalledWith("회의");
  });

  it("검색 결과를 하이라이트·카운트와 함께 보여준다", async () => {
    searchMock.mockResolvedValue({ kind: "ok", memos: [makeMemo("m9", "옛날 회의록", "안건 정리")] });
    renderList();
    await typeAndFlush("회의");
    expect(screen.getByText("1개 결과")).toBeTruthy();
    // 하이라이트가 제목을 분절하므로 heading 전체 텍스트 + <mark> 존재로 확인
    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading.textContent).toBe("옛날 회의록");
    const mark = heading.querySelector("mark");
    expect(mark?.textContent).toBe("회의");
    // 원본 목록은 숨겨진다
    expect(screen.queryByText("장보기")).toBeNull();
  });

  it("결과 없음 상태를 보여준다", async () => {
    renderList();
    await typeAndFlush("없는말");
    expect(screen.getByText("‘없는말’에 대한 결과가 없습니다.")).toBeTruthy();
  });

  it("액션 실패 시 실패 문구를 보여준다", async () => {
    searchMock.mockResolvedValue({ kind: "failed" });
    renderList();
    await typeAndFlush("아무거나");
    expect(screen.getByText("검색에 실패했습니다 — 다시 시도해 주세요.")).toBeTruthy();
  });

  it("ESC로 지우면 원본 목록으로 돌아간다", async () => {
    renderList();
    await typeAndFlush("회의");
    const input = screen.getByRole("searchbox", { name: "메모 검색" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.getByText("장보기")).toBeTruthy();
  });

  it("지우기 버튼도 원본 목록으로 복귀한다", async () => {
    renderList();
    await typeAndFlush("회의");
    fireEvent.click(screen.getByRole("button", { name: "검색어 지우기" }));
    expect(screen.getByText("장보기")).toBeTruthy();
  });
});
