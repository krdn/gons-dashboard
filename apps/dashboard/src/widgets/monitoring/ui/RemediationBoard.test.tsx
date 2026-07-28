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

describe("보드 판독 도움말", () => {
  // 기록이 비었을 때야말로 "왜 아무것도 없나" 를 설명해야 한다 — 도움말이
  // 목록 분기 안으로 들어가면 정확히 그 순간 사라진다.
  it("시도 기록이 없어도 도움말은 보인다", () => {
    render(<RemediationBoard rows={[]} now={NOW} />);
    expect(screen.getByText(/이 보드 읽는 법/)).toBeDefined();
  });

  it("스킵이 실패가 아님을 명시한다", () => {
    render(<RemediationBoard rows={[]} now={NOW} />);
    expect(screen.getByText(/스킵은 실패가 아닙니다/)).toBeDefined();
  });

  // 6시간 중복 억제는 recordSkip 에만 있다. "반복 = 시도 아님" 을 outcome 전체로
  // 일반화하면 executed/failed 의 진짜 재시도를 운영자가 무시하게 된다.
  it("실행됨·실패의 반복은 실제 재시도임을 구분해 알린다", () => {
    render(<RemediationBoard rows={[]} now={NOW} />);
    expect(
      screen.getByText(/실행됨·실패가 같은 대상에 반복됐다면 그것은 실제 재시도다/),
    ).toBeDefined();
  });
});
