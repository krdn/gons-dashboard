// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
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

  // #342: 세로 길이 억제 — 초기 8건만 노출, "더보기" 토글로 펼침.
  function makeN(n: number): MonitoringEventRow[] {
    return Array.from({ length: n }, (_, i) =>
      makeEvent({ id: `e${i}`, dedupKey: `k${i}`, title: `이벤트 ${i}` }),
    );
  }

  it("9건 → 초기 8건만 렌더 + '더보기 1건' 버튼", () => {
    render(<EventsTimeline events={makeN(9)} now={NOW} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    expect(screen.getByRole("button", { name: /더보기 1건/ })).toBeTruthy();
    // 9번째(index 8)는 아직 숨김
    expect(screen.queryByText("이벤트 8")).toBeNull();
  });

  it("'더보기' 클릭 → 전체 렌더 + 버튼이 '접기'로 전환", () => {
    render(<EventsTimeline events={makeN(9)} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: /더보기/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(9);
    expect(screen.getByText("이벤트 8")).toBeTruthy();
    expect(screen.getByRole("button", { name: "접기" })).toBeTruthy();
  });

  it("8건 이하 → 토글 버튼 없음", () => {
    render(<EventsTimeline events={makeN(8)} now={NOW} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
