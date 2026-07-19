// 앱 cron 실행 보드 — job별 최종 실행·상태·소요·24h 집계.
import "server-only";
import { type CronRunBoardRow } from "@/entities/monitoring/server";
import { formatAgo, formatKstTime } from "../lib/format";

const STATUS_STYLE: Record<string, { color: string; label: string }> = {
  ok: { color: "var(--color-severity-ok)", label: "성공" },
  partial: { color: "var(--color-warn)", label: "부분 실패" },
  error: { color: "var(--color-severity-high)", label: "실패" },
};

export function CronRunsBoard({
  rows,
  now,
}: {
  rows: CronRunBoardRow[];
  now: Date;
}) {
  return (
    <section
      aria-labelledby="cron-runs-title"
      className="rounded-xl border border-[var(--color-hairline)] bg-white p-4"
    >
      <h2
        id="cron-runs-title"
        className="mb-3 flex items-baseline gap-2 text-base font-semibold tracking-tight"
      >
        cron 실행
        <span className="font-mono text-xs font-medium tabular-nums text-[var(--color-text-muted)]">
          {rows.length}
        </span>
      </h2>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">
          실행 기록 대기 중 — 다음 cron 주기부터 기록됩니다.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-hairline)] text-xs text-[var(--color-text-muted)]">
                <th className="px-3 py-1.5 text-left font-medium">작업</th>
                <th className="px-3 py-1.5 text-left font-medium">최종 실행</th>
                <th className="px-3 py-1.5 text-left font-medium">상태</th>
                <th className="px-3 py-1.5 text-right font-medium">소요</th>
                <th className="px-3 py-1.5 text-right font-medium">24h 실패/실행</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = STATUS_STYLE[r.lastStatus] ?? {
                  color: "var(--color-text-muted)",
                  label: r.lastStatus,
                };
                return (
                  <tr
                    key={r.job}
                    className="border-b border-[var(--color-hairline)] last:border-b-0 hover:bg-[var(--color-surface-2)]"
                  >
                    <td className="px-3 py-1.5 font-mono text-xs">{r.job}</td>
                    <td className="px-3 py-1.5 text-xs tabular-nums text-[var(--color-text-muted)]">
                      {formatKstTime(r.lastRunAt)}{" "}
                      <span className="text-[var(--color-text-subtle)]">
                        ({formatAgo(r.lastRunAt, now)})
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-xs font-semibold" style={{ color: s.color }}>
                      {s.label}
                    </td>
                    <td className="px-3 py-1.5 text-right text-xs tabular-nums text-[var(--color-text-muted)]">
                      {(r.lastDurationMs / 1000).toFixed(1)}s
                    </td>
                    <td
                      className="px-3 py-1.5 text-right text-xs tabular-nums"
                      style={{
                        color:
                          r.failures24h > 0
                            ? "var(--color-severity-high)"
                            : "var(--color-text-muted)",
                      }}
                    >
                      {r.failures24h} / {r.runs24h}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
