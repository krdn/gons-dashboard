// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MemoDigestView } from "./MemoDigestView";

afterEach(cleanup);

const base = {
  weekEnd: "2026-07-12",
  summary: "이번 주엔 회의와 장보기 메모를 남겼습니다.",
  memoCount: 2,
  resurfaced: [],
};

describe("MemoDigestView", () => {
  it("주간 라벨과 요약을 렌더한다", () => {
    render(<MemoDigestView {...base} />);
    expect(screen.getByText("주간 메모 다이제스트")).toBeTruthy();
    expect(screen.getByText("7/6 – 7/12")).toBeTruthy();
    expect(screen.getByText(base.summary)).toBeTruthy();
  });

  it("빈 주(memoCount=0)는 요약 대신 안내 문구", () => {
    render(<MemoDigestView {...base} memoCount={0} summary="" />);
    expect(screen.getByText("지난주에 작성한 메모가 없습니다.")).toBeTruthy();
  });

  it("재부상 메모 목록과 locale-free 날짜를 렌더한다", () => {
    render(
      <MemoDigestView
        {...base}
        resurfaced={[{ id: "r1", title: "옛 아이디어", createdAt: new Date("2026-04-01T09:00:00") }]}
      />,
    );
    expect(screen.getByText("다시 보기 — 잊고 있던 메모")).toBeTruthy();
    expect(screen.getByText("옛 아이디어")).toBeTruthy();
    expect(screen.getByText("2026-04-01")).toBeTruthy();
  });

  it("재부상 없으면 다시 보기 섹션이 없다", () => {
    render(<MemoDigestView {...base} />);
    expect(screen.queryByText("다시 보기 — 잊고 있던 메모")).toBeNull();
  });
});
