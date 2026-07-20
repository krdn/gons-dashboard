// @vitest-environment jsdom
// ⚠️ 이 지시자가 없으면 vitest 기본 환경(node)에서 document 가 없어
// Testing Library 가 즉시 죽는다 (vitest.config.ts 의 environment: "node").
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MonitoringTabs } from "./MonitoringTabs";

const mockPathname = vi.fn<() => string>();
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

// 이 프로젝트는 globals/자동 cleanup 이 없어 (vitest.config.ts) render 한 DOM 이
// 테스트 간 누적된다 — 명시 cleanup 필수. EventsTimeline.test.tsx 와 같은 관례.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MonitoringTabs", () => {
  it("두 탭을 렌더한다", () => {
    mockPathname.mockReturnValue("/monitoring");
    render(<MonitoringTabs />);
    expect(screen.getByRole("link", { name: "인프라" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "GitHub" })).toBeTruthy();
  });

  it("/monitoring 에서는 인프라 탭이 활성", () => {
    mockPathname.mockReturnValue("/monitoring");
    render(<MonitoringTabs />);
    expect(screen.getByRole("link", { name: "인프라" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "GitHub" }).getAttribute("aria-current")).toBeNull();
  });

  // 하위 경로에서 인프라 탭이 활성으로 남으면 안 된다 (prefix 매칭 함정).
  it("/monitoring/github 에서는 GitHub 탭만 활성", () => {
    mockPathname.mockReturnValue("/monitoring/github");
    render(<MonitoringTabs />);
    expect(screen.getByRole("link", { name: "GitHub" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "인프라" }).getAttribute("aria-current")).toBeNull();
  });
});
