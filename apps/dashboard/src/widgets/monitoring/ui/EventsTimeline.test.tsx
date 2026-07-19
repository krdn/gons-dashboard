// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { EventsTimeline } from "./EventsTimeline";
import type { MonitoringEventRow } from "@/entities/monitoring/server";

afterEach(cleanup);

const NOW = new Date("2026-07-19T12:10:00+09:00");

function makeEvent(overrides: Partial<MonitoringEventRow>): MonitoringEventRow {
  return {
    id: "e1",
    source: "host",
    severity: "warning",
    title: "CPU 사용률 92% (임계 90%)",
    detail: null,
    dedupKey: "host:h1:cpu",
    hostId: "h1",
    occurredAt: new Date("2026-07-19T12:00:00+09:00"),
    resolvedAt: null,
    notifiedAt: null,
    resolvedNotifiedAt: null,
    ...overrides,
  };
}

describe("EventsTimeline", () => {
  it("빈 목록 → 정상 범위 empty 상태", () => {
    render(<EventsTimeline events={[]} now={NOW} />);
    expect(screen.getByText(/이벤트 없음/)).toBeTruthy();
  });

  it("severity 를 색이 아닌 텍스트로도 전달 (경고/위험 라벨)", () => {
    render(
      <EventsTimeline
        events={[
          makeEvent({ id: "e1", severity: "warning" }),
          makeEvent({ id: "e2", severity: "critical", dedupKey: "k2" }),
        ]}
        now={NOW}
      />,
    );
    expect(screen.getByText("경고")).toBeTruthy();
    expect(screen.getByText("위험")).toBeTruthy();
    expect(screen.getAllByText(/CPU 사용률 92%/)).toHaveLength(2);
  });

  it("resolved 이벤트는 해소 배지 표시", () => {
    render(
      <EventsTimeline
        events={[
          makeEvent({ resolvedAt: new Date("2026-07-19T12:05:00+09:00") }),
        ]}
        now={NOW}
      />,
    );
    expect(screen.getByText(/해소/)).toBeTruthy();
  });
});
