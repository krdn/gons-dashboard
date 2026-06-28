// @vitest-environment jsdom
// Sidebar 트리 네비게이션 — 그룹 펼침/접힘 + 현재 경로 자동 펼침 + collapsed 평탄화.
// 브라우저 인터랙션 없이 회귀를 결정적으로 잡는다 (catalog 토글 테스트 교훈).
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// usePathname 을 테스트별로 제어
const mockPathname = vi.fn(() => "/");
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

import { Sidebar } from "@/widgets/app-shell/Sidebar";

afterEach(() => {
  cleanup();
  mockPathname.mockReturnValue("/");
});

describe("Sidebar 트리 네비게이션", () => {
  it("그룹 헤더 클릭 시 자식 링크가 나타났다 사라진다", () => {
    mockPathname.mockReturnValue("/"); // 어떤 그룹도 자동 펼침 안 됨
    render(<Sidebar collapsed={false} />);

    // 초기엔 닫혀 있어 자식(스킬) 안 보임
    expect(screen.queryByText("스킬")).toBeNull();

    const claudeHeader = screen.getByRole("button", { name: /Claude Code/ });
    fireEvent.click(claudeHeader);
    expect(screen.getByText("스킬")).toBeTruthy();
    expect(screen.getByText("플러그인")).toBeTruthy();

    fireEvent.click(claudeHeader);
    expect(screen.queryByText("스킬")).toBeNull();
  });

  it("현재 경로가 속한 그룹은 초기에 자동으로 펼쳐진다", () => {
    mockPathname.mockReturnValue("/plugins");
    render(<Sidebar collapsed={false} />);

    // /plugins 가 Claude Code 그룹 소속 → 자동 펼침
    expect(screen.getByText("플러그인")).toBeTruthy();
    const claudeHeader = screen.getByRole("button", { name: /Claude Code/ });
    expect(claudeHeader.getAttribute("aria-expanded")).toBe("true");

    // 다른 그룹(개인)은 닫힘
    const personalHeader = screen.getByRole("button", { name: /개인/ });
    expect(personalHeader.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("주식")).toBeNull();
  });

  it("collapsed 모드에서는 그룹 헤더 없이 모든 잎 아이콘이 평탄하게 나열된다", () => {
    mockPathname.mockReturnValue("/");
    render(<Sidebar collapsed />);

    // 그룹 토글 버튼이 없어야 한다
    expect(screen.queryByRole("button")).toBeNull();

    // 모든 잎이 링크로 존재 (라벨은 title 속성으로만 — 텍스트 노출 안 함)
    const links = screen.getAllByRole("link");
    const hrefs = links.map((l) => l.getAttribute("href")).sort();
    expect(hrefs).toEqual(
      ["/", "/agents", "/fortune", "/plugins", "/skills", "/stocks", "/tiger"].sort(),
    );
  });
});
