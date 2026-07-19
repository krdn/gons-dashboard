// 컨테이너 리소스 표 — CPU desc 정렬 (쿼리가 보장), 숫자 우측 정렬 tabular-nums.
import "server-only";
import { type ContainerStatRow } from "@/entities/monitoring/server";
import { formatMib } from "../lib/format";

const NUM_TD = "px-3 py-1.5 text-right tabular-nums";

export function ContainerStatsBoard({
  rows,
  multiHost,
}: {
  rows: ContainerStatRow[];
  multiHost: boolean;
}) {
  return (
    <section
      aria-labelledby="container-stats-title"
      className="rounded-xl border border-[var(--color-hairline)] bg-white p-4"
    >
      <h2
        id="container-stats-title"
        className="mb-3 flex items-baseline gap-2 text-base font-semibold tracking-tight"
      >
        컨테이너 리소스
        <span className="font-mono text-xs font-medium tabular-nums text-[var(--color-text-muted)]">
          {rows.length}
        </span>
      </h2>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">
          수집 대기 중 — cron 이 1분 주기로 docker stats 를 수집합니다.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-hairline)] text-xs text-[var(--color-text-muted)]">
                <th className="px-3 py-1.5 text-left font-medium">컨테이너</th>
                {multiHost && <th className="px-3 py-1.5 text-left font-medium">호스트</th>}
                <th className="px-3 py-1.5 text-right font-medium">CPU</th>
                <th className="px-3 py-1.5 text-right font-medium">MEM</th>
                <th className="px-3 py-1.5 text-right font-medium">사용량</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.hostName}|${r.container}`}
                  className="border-b border-[var(--color-hairline)] last:border-b-0 hover:bg-[var(--color-surface-2)]"
                >
                  <td className="max-w-64 truncate px-3 py-1.5 font-mono text-xs">
                    {r.container}
                  </td>
                  {multiHost && (
                    <td className="px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)]">
                      {r.hostName}
                    </td>
                  )}
                  <td
                    className={NUM_TD}
                    style={{
                      color:
                        r.cpuPct >= 200
                          ? "var(--color-warn)"
                          : "var(--color-text)",
                    }}
                  >
                    {r.cpuPct.toFixed(1)}%
                  </td>
                  <td className={NUM_TD}>{r.memPct.toFixed(1)}%</td>
                  <td className={`${NUM_TD} text-[var(--color-text-muted)]`}>
                    {formatMib(r.memUsedMb)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
