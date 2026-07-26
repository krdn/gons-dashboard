// 호스트 Vitals 히어로 보드 — CPU/MEM/DISK/온도/GPU/네트워크 최신값 타일.
// 임계값 색상은 evaluateVitals 와 같은 기준(VITALS_TIERS — 단일 소스).
import "server-only";
import {
  type HostMetricsSnapshot,
  type LatestMetric,
} from "@/entities/monitoring/server";
import { VITALS_TIERS, type VitalsTier } from "@/features/monitoring-ingest";
import { formatAgo, formatBps, formatUptime } from "../lib/format";

// GPU 지표가 같은 호스트의 다른 지표보다 이만큼 뒤처지면 "관측 중단" 으로 본다
// (에이전트 수집 주기 15초의 6배 — 일시적 지연과 구분).
const GPU_STALE_MS = 90_000;

function metricOf(metrics: LatestMetric[], name: string): LatestMetric | null {
  return metrics.find((m) => m.metric === name) ?? null;
}

function metricsOf(metrics: LatestMetric[], name: string): LatestMetric[] {
  return metrics.filter((m) => m.metric === name);
}

function pctColor(value: number | null, tier: VitalsTier): string {
  if (value == null) return "var(--color-text)";
  if (value >= tier.crit) return "var(--color-severity-high)";
  if (value >= tier.warn) return "var(--color-warn)";
  return "var(--color-text)";
}

function Tile({
  label,
  value,
  unit,
  color,
  sub,
}: {
  label: string;
  value: string;
  unit?: string;
  color?: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg bg-[var(--color-surface-2)] p-3">
      <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
      <p
        className="mt-1 text-2xl font-bold tabular-nums leading-tight"
        style={{ color: color ?? "var(--color-text)" }}
      >
        {value}
        {unit && <span className="ml-0.5 text-sm font-medium">{unit}</span>}
      </p>
      {sub && (
        <p className="mt-1 truncate text-xs tabular-nums text-[var(--color-text-subtle)]">
          {sub}
        </p>
      )}
    </div>
  );
}

function DiskRow({ mount, usedPct }: { mount: string; usedPct: number }) {
  const color = pctColor(usedPct, VITALS_TIERS.disk);
  return (
    <li className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 truncate font-mono text-xs text-[var(--color-text-muted)]">
        {mount}
      </span>
      <span
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--color-hairline)]"
        role="presentation"
      >
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.min(100, usedPct)}%`, backgroundColor: color }}
        />
      </span>
      <span className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums" style={{ color }}>
        {Math.round(usedPct)}%
      </span>
    </li>
  );
}

function HostVitals({ snapshot, now }: { snapshot: HostMetricsSnapshot; now: Date }) {
  const m = snapshot.metrics;
  const cpu = metricOf(m, "cpu.pct");
  const mem = metricOf(m, "mem.used_pct");
  const swap = metricOf(m, "swap.used_mb");
  const temp = metricOf(m, "temp.cpu_c");
  const gpuUtil = metricOf(m, "gpu.util_pct");
  const gpuVram = metricOf(m, "gpu.vram_pct");
  const gpuTemp = metricOf(m, "gpu.temp_c");
  // 에이전트가 GPU 수집을 포기하면 gpu.* 지표가 끊기고 30분 조회 창을 벗어나는 순간
  // 타일이 통째로 사라져 "GPU 없는 호스트" 와 구분되지 않는다. 에이전트가 대신 보내는
  // 이 명시 신호로 장애를 계속 드러낸다.
  const gpuUnavailable = metricOf(m, "gpu.unavailable");
  const uptime = metricOf(m, "uptime.sec");
  const reboot = metricOf(m, "reboot.required");
  const load1 = metricOf(m, "load.1");
  const load5 = metricOf(m, "load.5");
  const load15 = metricOf(m, "load.15");
  const disks = metricsOf(m, "disk.used_pct").sort((a, b) =>
    (a.labels?.mount ?? "").localeCompare(b.labels?.mount ?? ""),
  );
  const nets = metricsOf(m, "net.rx_bps");

  const ageSec =
    snapshot.lastCollectedAt == null
      ? null
      : Math.floor((now.getTime() - snapshot.lastCollectedAt.getTime()) / 1000);
  const stale = ageSec != null && ageSec > 60;
  const dead = ageSec != null && ageSec > 300;

  // 에이전트가 드라이버 잠김으로 GPU 수집을 포기해도(agent.sh 서킷 브레이커) 조회 창
  // 30분 안에서는 마지막 GPU 값이 계속 잡힌다. 다른 지표는 갱신되므로 카드 전체가
  // 최신처럼 보이고 GPU 타일만 과거값을 현재값으로 표시하는 미탐이 생긴다 — 낡은
  // 관측치를 현재값으로 재사용하지 않는다는 원칙(agent.sh security 섹션과 동일)을 지킨다.
  const gpuStale =
    gpuUtil != null &&
    snapshot.lastCollectedAt != null &&
    snapshot.lastCollectedAt.getTime() - gpuUtil.collectedAt.getTime() > GPU_STALE_MS;

  return (
    <section className="rounded-xl border border-[var(--color-hairline)] bg-white p-4 text-[var(--color-text)]">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span className="font-mono">{snapshot.hostName}</span>
          {reboot?.value === 1 && (
            <span className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{
                color: "var(--color-warn)",
                backgroundColor: "color-mix(in oklch, var(--color-warn) 12%, white)",
              }}
            >
              재부팅 대기
            </span>
          )}
        </h3>
        <span
          className={`text-xs tabular-nums ${stale ? "font-semibold" : ""}`}
          style={{
            color: dead
              ? "var(--color-severity-high)"
              : stale
                ? "var(--color-warn)"
                : "var(--color-text-subtle)",
          }}
        >
          {snapshot.lastCollectedAt == null
            ? "수집 없음"
            : dead
              ? `수집 중단 — ${formatAgo(snapshot.lastCollectedAt, now)}`
              : stale
                ? `수집 지연 — ${formatAgo(snapshot.lastCollectedAt, now)}`
                : `${formatAgo(snapshot.lastCollectedAt, now)} 수집`}
        </span>
      </header>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Tile
          label="CPU"
          value={cpu ? cpu.value.toFixed(1) : "–"}
          unit="%"
          color={pctColor(cpu?.value ?? null, VITALS_TIERS.cpu)}
          sub={
            load1
              ? `load ${load1.value.toFixed(2)} / ${load5?.value.toFixed(2) ?? "–"} / ${load15?.value.toFixed(2) ?? "–"}`
              : undefined
          }
        />
        <Tile
          label="메모리"
          value={mem ? mem.value.toFixed(1) : "–"}
          unit="%"
          color={pctColor(mem?.value ?? null, VITALS_TIERS.mem)}
          sub={swap ? `스왑 ${Math.round(swap.value)}MiB` : undefined}
        />
        <Tile
          label="CPU 온도"
          value={temp ? temp.value.toFixed(0) : "–"}
          unit="°C"
          color={pctColor(temp?.value ?? null, VITALS_TIERS.temp)}
          sub={uptime ? `업타임 ${formatUptime(uptime.value)}` : undefined}
        />
        {gpuUtil == null && gpuUnavailable != null && (
          <Tile
            label="GPU"
            value="–"
            color="var(--color-warn)"
            sub={`관측 불가 — ${formatAgo(gpuUnavailable.collectedAt, now)} 기준`}
          />
        )}
        {gpuUtil != null && (
          <Tile
            label="GPU"
            value={gpuStale ? "–" : gpuUtil.value.toFixed(0)}
            unit={gpuStale ? undefined : "%"}
            color={
              gpuStale
                ? "var(--color-text-subtle)"
                : pctColor(gpuVram?.value ?? null, VITALS_TIERS.gpuVram)
            }
            sub={
              gpuStale
                ? `관측 중단 — ${formatAgo(gpuUtil.collectedAt, now)}`
                : `VRAM ${gpuVram?.value.toFixed(0) ?? "–"}% · ${gpuTemp?.value.toFixed(0) ?? "–"}°C`
            }
          />
        )}
        {nets.map((rx) => {
          const tx = m.find(
            (x) => x.metric === "net.tx_bps" && x.labels?.iface === rx.labels?.iface,
          );
          return (
            <Tile
              key={rx.labels?.iface}
              label={`네트워크 ${rx.labels?.iface ?? ""}`}
              value={formatBps(rx.value)}
              sub={tx ? `송신 ${formatBps(tx.value)}` : undefined}
            />
          );
        })}
      </div>

      {disks.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-[var(--color-hairline)] pt-3">
          {disks.map((d) => (
            <DiskRow
              key={d.labels?.mount ?? "?"}
              mount={d.labels?.mount ?? "?"}
              usedPct={d.value}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function VitalsBoard({
  snapshots,
  now,
}: {
  snapshots: HostMetricsSnapshot[];
  now: Date;
}) {
  if (snapshots.length === 0) {
    return (
      <section className="rounded-xl border border-[var(--color-hairline)] bg-white p-6 text-center">
        <p className="text-sm font-medium text-[var(--color-text)]">
          수집된 호스트 지표가 없습니다
        </p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          호스트에 모니터링 에이전트를 설치하세요 —{" "}
          <code className="font-mono">scripts/monitoring-agent/README.md</code>
        </p>
      </section>
    );
  }
  return (
    <div className="space-y-3">
      {snapshots.map((s) => (
        <HostVitals key={s.hostId} snapshot={s} now={now} />
      ))}
    </div>
  );
}
