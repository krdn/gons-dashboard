// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CycleHistoryList } from "@/widgets/autopilot/ui/CycleHistoryList";
import { NextCandidates } from "@/widgets/autopilot/ui/NextCandidates";
import type { AutopilotCycle } from "@/entities/autopilot-cycle/client";

// globals:true 가 아니라 RTL 자동 cleanup 이 등록되지 않는다 — 수동 등록.
afterEach(cleanup);

const cycle = (over: Partial<AutopilotCycle>): AutopilotCycle => ({
  id: "autopilot-2026-W23",
  isoWeek: "2026-W23",
  runAt: new Date(),
  mode: "shadow",
  deployFlag: "off",
  candidateCount: 5,
  selectedTitle: "Next 16.3",
  selectedScore: 4.2,
  selectedChangeType: "deps",
  selectedOwner: "dependency-security",
  prUrl: "https://github.com/krdn/gons-dashboard/pull/131",
  merged: true,
  needsHuman: false,
  reason: null,
  backlogTop3: [],
  ...over,
});

describe("CycleHistoryList", () => {
  it("이력 0건이면 empty state를 보여준다", () => {
    render(<CycleHistoryList cycles={[]} />);
    expect(screen.getByText(/첫 사이클이 아직 실행되지 않았습니다/)).toBeTruthy();
  });

  it("prUrl이 있으면 링크로 렌더한다", () => {
    render(<CycleHistoryList cycles={[cycle({})]} />);
    const link = screen.getByText("✓머지").closest("a");
    expect(link?.getAttribute("href")).toContain("/pull/131");
  });

  it("prUrl이 없으면 링크 대신 텍스트로 렌더한다", () => {
    render(
      <CycleHistoryList
        cycles={[cycle({ prUrl: null, merged: false, reason: "implementation-gate-failed" })]}
      />,
    );
    expect(screen.getByText("implementation-gate-failed").closest("a")).toBeNull();
  });
});

describe("NextCandidates", () => {
  it("후보 0건이면 empty state를 보여준다", () => {
    render(<NextCandidates candidates={[]} />);
    expect(screen.getByText(/여기에 TOP 3가 표시됩니다/)).toBeTruthy();
  });
});
