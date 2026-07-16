// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { MemoHelpView } from "./MemoHelpView";
import type { MemoHelpGuide } from "../model/types";

afterEach(cleanup);

// 실 콘텐츠와 분리된 최소 fixture — 문구 변경이 인터랙션 테스트를 깨지 않게 한다.
const guide: MemoHelpGuide = {
  quickStart: ["첫 단계", "둘째 단계"],
  chapters: [
    { id: "capture", title: "기록하기", tagline: "즉시 적는다", inFlow: true },
    { id: "manage", title: "관리", tagline: "편집·삭제", inFlow: false },
  ],
  features: [
    {
      id: "voice-memo",
      chapterId: "capture",
      icon: "🎙",
      title: "음성 메모",
      summary: "말하면 받아쓴다",
      steps: ["녹음한다", "저장한다"],
    },
    {
      id: "auto-thing",
      chapterId: "capture",
      icon: "🏷",
      title: "자동 분류",
      auto: true,
      summary: "알아서 분류",
      steps: ["저장하면 배지가 붙는다"],
    },
    {
      id: "edit-delete",
      chapterId: "manage",
      icon: "✏️",
      title: "편집과 삭제",
      summary: "카드에서 고친다",
      steps: ["편집을 누른다"],
      link: { href: "/memos/settings", label: "설정 열기" },
    },
  ],
};

describe("MemoHelpView", () => {
  it("빠른 시작·지도·상세 카드가 모두 렌더된다", () => {
    render(<MemoHelpView guide={guide} />);
    expect(screen.getByText("첫 단계")).toBeTruthy();
    // 지도에는 inFlow 챕터만 — 관리 챕터는 지도 밖, 상세에는 있다.
    const map = screen.getByRole("navigation", { name: "메모 생애주기 지도" });
    expect(map.textContent).toContain("기록하기");
    expect(map.textContent).not.toContain("편집과 삭제");
    expect(screen.getByRole("heading", { name: "편집과 삭제" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "설정 열기 →" })).toBeTruthy();
  });

  it("자동 기능에는 자동 뱃지와 '이렇게 동작해요' 헤딩이 붙는다", () => {
    render(<MemoHelpView guide={guide} />);
    expect(screen.getAllByText("자동").length).toBeGreaterThan(0);
    expect(screen.getByText("이렇게 동작해요")).toBeTruthy();
    // 수동 기능은 "이렇게 사용해요" — 두 카드가 있으니 복수.
    expect(screen.getAllByText("이렇게 사용해요").length).toBe(2);
  });

  it("지도 노드를 누르면 해당 상세 카드가 하이라이트된다", () => {
    render(<MemoHelpView guide={guide} />);
    const node = screen.getByRole("button", { name: /음성 메모/ });
    fireEvent.click(node);
    expect(node.getAttribute("aria-current")).toBe("true");
    const card = screen.getByRole("heading", { name: "음성 메모" }).closest("article");
    expect(card?.getAttribute("data-active")).toBe("true");
    // 다른 카드는 하이라이트되지 않는다.
    const other = screen.getByRole("heading", { name: "자동 분류" }).closest("article");
    expect(other?.getAttribute("data-active")).toBeNull();
  });

  it("다른 노드를 누르면 하이라이트가 이동한다", () => {
    render(<MemoHelpView guide={guide} />);
    fireEvent.click(screen.getByRole("button", { name: /음성 메모/ }));
    fireEvent.click(screen.getByRole("button", { name: /자동 분류/ }));
    const first = screen.getByRole("heading", { name: "음성 메모" }).closest("article");
    const second = screen.getByRole("heading", { name: "자동 분류" }).closest("article");
    expect(first?.getAttribute("data-active")).toBeNull();
    expect(second?.getAttribute("data-active")).toBe("true");
  });
});
