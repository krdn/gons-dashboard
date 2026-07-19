import { describe, it, expect } from "vitest";
import { flattenVitals } from "./flattenVitals";
import { type VitalsPayload } from "../model/vitalsSchema";

const HOST_ID = "11111111-1111-1111-1111-111111111111";
const AT = new Date("2026-07-19T12:00:00+09:00");

const payload: VitalsPayload = {
  host: "home-server",
  cpuPct: 12.5,
  load1: 1.1,
  load5: 0.9,
  load15: 0.7,
  memUsedPct: 43.2,
  swapUsedMb: 965,
  disks: [{ mount: "/", usedPct: 71, inodePct: 8 }],
  cpuTempC: 62,
  gpu: { utilPct: 15, vramPct: 22, tempC: 48 },
  net: [{ iface: "enp3s0", rxBps: 1200, txBps: 800 }],
  uptimeSec: 86400,
  rebootRequired: true,
};

describe("flattenVitals", () => {
  const rows = flattenVitals(HOST_ID, payload, AT);

  function row(metric: string, labels?: Record<string, string>) {
    const found = rows.find(
      (r) =>
        r.metric === metric &&
        JSON.stringify(r.labels ?? null) === JSON.stringify(labels ?? null),
    );
    if (!found) throw new Error(`row ${metric} ${JSON.stringify(labels)} 없음`);
    return found;
  }

  it("호스트 vitals 를 메트릭 카탈로그 이름으로 평탄화한다", () => {
    expect(row("cpu.pct").value).toBe(12.5);
    expect(row("load.1").value).toBe(1.1);
    expect(row("mem.used_pct").value).toBe(43.2);
    expect(row("swap.used_mb").value).toBe(965);
    expect(row("temp.cpu_c").value).toBe(62);
    expect(row("gpu.vram_pct").value).toBe(22);
    expect(row("uptime.sec").value).toBe(86400);
  });

  it("labels 차원 — mount/iface", () => {
    expect(row("disk.used_pct", { mount: "/" }).value).toBe(71);
    expect(row("disk.inode_pct", { mount: "/" }).value).toBe(8);
    expect(row("net.rx_bps", { iface: "enp3s0" }).value).toBe(1200);
  });

  it("rebootRequired 는 0/1 로 저장", () => {
    expect(row("reboot.required").value).toBe(1);
  });

  it("모든 row 가 hostId·collectedAt 을 가진다", () => {
    expect(rows.every((r) => r.hostId === HOST_ID && r.collectedAt === AT)).toBe(true);
  });

  it("optional 필드 미제공 시 해당 row 없음", () => {
    const slim = flattenVitals(
      HOST_ID,
      { ...payload, gpu: undefined, net: undefined, cpuTempC: undefined },
      AT,
    );
    const metrics = slim.map((r) => r.metric);
    expect(metrics).not.toContain("gpu.util_pct");
    expect(metrics).not.toContain("net.rx_bps");
    expect(metrics).not.toContain("temp.cpu_c");
  });
});
