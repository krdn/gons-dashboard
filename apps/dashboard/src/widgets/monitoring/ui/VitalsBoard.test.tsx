// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { VitalsBoard } from "./VitalsBoard";
import type {
  HostMetricsSnapshot,
  LatestMetric,
} from "@/entities/monitoring/server";

afterEach(cleanup);

const NOW = new Date("2026-07-26T15:00:00+09:00");
const FRESH = new Date("2026-07-26T14:59:50+09:00"); // 10초 전 = 정상 수집

function metric(
  name: string,
  value: number,
  collectedAt: Date = FRESH,
): LatestMetric {
  return { metric: name, value, labels: null, collectedAt };
}

/** GPU 지표만 다른 시각으로 둘 수 있는 스냅샷 — stale 분기 검증용. */
function snapshot(gpuAt: Date): HostMetricsSnapshot {
  return {
    hostId: "h1",
    hostName: "home-server",
    metrics: [
      metric("cpu.pct", 12.5),
      metric("mem.used_pct", 40),
      metric("gpu.util_pct", 45, gpuAt),
      metric("gpu.vram_pct", 33, gpuAt),
      metric("gpu.temp_c", 50, gpuAt),
    ],
    lastCollectedAt: FRESH,
  };
}

describe("VitalsBoard", () => {
  it("스냅샷이 없으면 빈 상태를 보여준다", () => {
    render(<VitalsBoard snapshots={[]} now={NOW} />);
    expect(screen.getByText(/수집된 호스트 지표가 없습니다/)).toBeTruthy();
  });

  it("GPU 지표가 최신이면 값을 표시한다", () => {
    render(<VitalsBoard snapshots={[snapshot(FRESH)]} now={NOW} />);
    expect(screen.getByText("45")).toBeTruthy();
    expect(screen.queryByText(/관측 중단/)).toBeNull();
  });

  // 조회 창(30분)이 수집 주기보다 훨씬 길어, GPU 수집이 끊겨도 마지막 값이 계속 잡힌다.
  // 다른 지표는 갱신되므로 카드 전체가 최신처럼 보이는 미탐이 생긴다 — 2026-07-24
  // 드라이버 잠김 사고에서 에이전트가 GPU 수집을 포기해도 보드는 정상으로 보였다.
  // GPU 지표가 30분 조회 창을 벗어나면 타일이 통째로 사라져, 고장난 GPU 를 가진 호스트가
  // "GPU 없는 호스트" 와 구분되지 않는다 — stale 표시보다 더 나쁜 미탐. 에이전트가
  // 서킷 브레이커 작동 시 보내는 gpu.unavailable 신호로 장애를 계속 드러낸다.
  it("GPU 지표가 창을 벗어나도 관측 불가 신호가 있으면 장애를 계속 표시한다", () => {
    render(
      <VitalsBoard
        snapshots={[
          {
            hostId: "h1",
            hostName: "home-server",
            metrics: [metric("cpu.pct", 12.5), metric("gpu.unavailable", 1)],
            lastCollectedAt: FRESH,
          },
        ]}
        now={NOW}
      />,
    );
    expect(screen.getByText(/관측 불가/)).toBeTruthy();
  });

  it("GPU 가 아예 없는 호스트는 GPU 타일을 만들지 않는다", () => {
    render(
      <VitalsBoard
        snapshots={[
          {
            hostId: "h1",
            hostName: "krdn-lenovo",
            metrics: [metric("cpu.pct", 12.5)],
            lastCollectedAt: FRESH,
          },
        ]}
        now={NOW}
      />,
    );
    expect(screen.queryByText("GPU")).toBeNull();
    expect(screen.queryByText(/관측 불가/)).toBeNull();
  });

  it("GPU 지표만 뒤처지면 낡은 값 대신 관측 중단을 표시한다", () => {
    const staleGpuAt = new Date(FRESH.getTime() - 120_000); // 2분 뒤처짐 > 90초 임계
    render(<VitalsBoard snapshots={[snapshot(staleGpuAt)]} now={NOW} />);
    expect(screen.getByText(/관측 중단/)).toBeTruthy();
    expect(screen.queryByText("45")).toBeNull();
  });
});
