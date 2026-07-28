// @vitest-environment jsdom
// Phase 1 의 목적은 사람이 dry-run 계획을 검토하는 것이다 — 조치 대상이
// 보이지 않으면 "이 판단이 맞나?" 를 판단할 수 없다 (findings §3 회귀).
import { afterEach, describe, it, expect } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { RemediationBoard } from "./RemediationBoard";
import type { RemediationAttemptRow } from "@/entities/monitoring/server";

afterEach(cleanup);

const NOW = new Date("2026-07-28T19:00:00+09:00");

function row(over: Partial<RemediationAttemptRow>): RemediationAttemptRow {
  return {
    id: "a1",
    eventId: null,
    dedupKey: "host:h1:disk:/",
    policyId: "prune-images",
    action: "-",
    dryRun: true,
    outcome: "skipped",
    reason: null,
    detail: null,
    attemptedAt: new Date("2026-07-28T18:59:00+09:00"),
    settledAt: null,
    ...over,
  };
}

describe("RemediationBoard 조치 대상 표시", () => {
  it("restart-container 행은 detail 의 컨테이너 이름을 보여준다", () => {
    render(
      <RemediationBoard
        rows={[
          row({
            id: "a2",
            policyId: "restart-container",
            action: "restart-container",
            outcome: "dry_run",
            dedupKey: "host:h1:container:gons-cron",
            detail: JSON.stringify({
              kind: "restart-container",
              hostId: "h1",
              containerId: "abc123def456",
              containerName: "gons-cron",
            }),
          }),
        ]}
        now={NOW}
      />,
    );
    expect(screen.getByText(/gons-cron \(abc123def456\)/)).toBeDefined();
  });

  it("raise-redis-maxmemory 행은 target 과 상향 값을 보여준다", () => {
    render(
      <RemediationBoard
        rows={[
          row({
            id: "a3",
            policyId: "redis-maxmemory",
            action: "raise-redis-maxmemory",
            outcome: "dry_run",
            detail: JSON.stringify({
              kind: "raise-redis-maxmemory",
              hostId: "h1",
              target: "ais-prod",
              nextBytes: 2 * 1024 ** 3,
            }),
          }),
        ]}
        now={NOW}
      />,
    );
    expect(screen.getByText(/ais-prod → 2\.0GiB/)).toBeDefined();
  });

  it("skip 행(detail 없음)도 dedupKey 로 대상을 식별할 수 있다", () => {
    render(<RemediationBoard rows={[row({})]} now={NOW} />);
    expect(screen.getByText("host:h1:disk:/")).toBeDefined();
  });
});
