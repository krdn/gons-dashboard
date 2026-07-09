// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { MemoCard } from "./MemoCard";
import type { Memo, MemoTransformation } from "../model/types";

afterEach(cleanup);

const memo = {
  id: "m1",
  userId: "u1",
  source: "voice",
  title: "회의 메모",
  rawContent: "음 어 회의는 세 시",
  cleanedContent: "회의는 세 시",
  createdAt: new Date("2026-07-09T10:00:00"),
  updatedAt: new Date("2026-07-09T10:00:00"),
} as Memo;

const summary = {
  id: "t1",
  memoId: "m1",
  preset: "summary",
  model: "claude-sonnet-5",
  content: "요약: 회의 3시",
  createdAt: new Date("2026-07-09T10:05:00"),
  updatedAt: new Date("2026-07-09T10:05:00"),
} as MemoTransformation;

describe("MemoCard 칩 전환", () => {
  it("기본은 정리본을 보여준다", () => {
    render(<MemoCard memo={memo} transformations={[summary]} />);
    expect(screen.getByText("회의는 세 시")).toBeTruthy();
  });
  it("원문 칩 클릭 시 raw 표시 (음성만)", () => {
    render(<MemoCard memo={memo} transformations={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "원문" }));
    expect(screen.getByText("음 어 회의는 세 시")).toBeTruthy();
  });
  it("변환본 칩 클릭 시 해당 content 표시", () => {
    render(<MemoCard memo={memo} transformations={[summary]} />);
    fireEvent.click(screen.getByRole("button", { name: "요약" }));
    expect(screen.getByText("요약: 회의 3시")).toBeTruthy();
  });
  it("텍스트 메모 + 변환 없음이면 칩 row가 없다", () => {
    render(<MemoCard memo={{ ...memo, source: "text" } as Memo} />);
    expect(screen.queryByRole("button", { name: "정리본" })).toBeNull();
  });
  it("onTransform이 있으면 AI 정리 버튼이 memo를 넘긴다", () => {
    const onTransform = vi.fn();
    render(<MemoCard memo={memo} onTransform={onTransform} />);
    fireEvent.click(screen.getByRole("button", { name: "AI 정리" }));
    expect(onTransform).toHaveBeenCalledWith(memo);
  });
});
