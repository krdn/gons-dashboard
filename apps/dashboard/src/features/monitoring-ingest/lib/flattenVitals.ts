// VitalsPayload → metric_samples insert row 평탄화.
// 메트릭 이름 카탈로그는 schema/monitoring.ts 주석과 동기 유지.
import { type metricSamples } from "@/shared/lib/db/schema";
import { type VitalsPayload } from "../model/vitalsSchema";

export type NewMetricSample = typeof metricSamples.$inferInsert;

export function flattenVitals(
  hostId: string,
  p: VitalsPayload,
  collectedAt: Date,
): NewMetricSample[] {
  const rows: NewMetricSample[] = [];
  const push = (metric: string, value: number, labels?: Record<string, string>) => {
    rows.push({ hostId, metric, value, labels: labels ?? null, collectedAt });
  };

  push("cpu.pct", p.cpuPct);
  push("load.1", p.load1);
  push("load.5", p.load5);
  push("load.15", p.load15);
  push("mem.used_pct", p.memUsedPct);
  push("swap.used_mb", p.swapUsedMb);

  for (const disk of p.disks) {
    push("disk.used_pct", disk.usedPct, { mount: disk.mount });
    if (disk.inodePct != null) {
      push("disk.inode_pct", disk.inodePct, { mount: disk.mount });
    }
  }

  if (p.cpuTempC != null) push("temp.cpu_c", p.cpuTempC);

  if (p.gpu != null) {
    push("gpu.util_pct", p.gpu.utilPct);
    push("gpu.vram_pct", p.gpu.vramPct);
    push("gpu.temp_c", p.gpu.tempC);
  } else if (p.gpuUnavailable) {
    // 관측 불가를 관측 없음과 구분한다. 매 사이클 갱신되므로 조회 창을 벗어나
    // GPU 장애가 화면에서 사라지는 일이 없다.
    push("gpu.unavailable", 1);
  }

  for (const net of p.net ?? []) {
    push("net.rx_bps", net.rxBps, { iface: net.iface });
    push("net.tx_bps", net.txBps, { iface: net.iface });
  }

  push("uptime.sec", p.uptimeSec);
  push("reboot.required", p.rebootRequired ? 1 : 0);

  return rows;
}
