import { describe, it, expect } from "vitest";
import { AutopilotCycleInput } from "@/entities/autopilot-cycle/model/inputSchema";

describe("AutopilotCycleInput", () => {
  it("정상 사이클(PR 생성) 입력을 통과시킨다", () => {
    const r = AutopilotCycleInput.safeParse({
      id: "autopilot-2026-W24",
      date: "2026-06-09T00:00:00.000Z",
      mode: "shadow",
      deployFlag: "off",
      candidateCount: 12,
      selected: { title: "Next.js 16.3", owner: "dependency-security", score: 4.2, changeType: "deps" },
      prUrl: "https://github.com/krdn/gons-dashboard/pull/131",
      merged: false,
      needsHuman: false,
      backlogTop3: [{ title: "Zod v4", score: 3.9, dedupKey: "deps:zod-4" }],
      debate: { selected: null, backlogTop3: [] },
    });
    expect(r.success).toBe(true);
  });

  it("후보 미선정(selected=null, reason 있음) 입력을 통과시킨다", () => {
    const r = AutopilotCycleInput.safeParse({
      id: "autopilot-2026-W22",
      date: "2026-05-26T00:00:00.000Z",
      mode: "shadow",
      candidateCount: 0,
      selected: null,
      reason: "no-candidate-selected",
      backlogTop3: [],
    });
    expect(r.success).toBe(true);
  });

  it("id 누락 시 거부한다", () => {
    const r = AutopilotCycleInput.safeParse({ mode: "shadow", candidateCount: 0 });
    expect(r.success).toBe(false);
  });

  it("KST offset 형식 date(+09:00)를 통과시킨다", () => {
    const r = AutopilotCycleInput.safeParse({
      id: "autopilot-2026-W23",
      date: "2026-06-02T09:00:00+09:00",
      mode: "shadow",
      candidateCount: 1,
      backlogTop3: [],
    });
    expect(r.success).toBe(true);
  });
});
