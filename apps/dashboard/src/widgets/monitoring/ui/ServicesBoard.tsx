// systemd 서비스·타이머 보드 (이슈 #323 §C-3·D) — 에이전트 checks push 기반.
import "server-only";
import { type LatestCheck } from "@/entities/monitoring/server";
import { formatAgo, formatKstTime } from "../lib/format";
import { checkStatusStyle, detailNum, detailStr } from "../lib/checkStatus";

function epochToDate(epoch: number | null): Date | null {
  return epoch != null ? new Date(epoch * 1000) : null;
}

export function ServicesBoard({
  services,
  timers,
  now,
}: {
  services: LatestCheck[];
  timers: LatestCheck[];
  now: Date;
}) {
  const svcRows = [...services].sort((a, b) => a.target.localeCompare(b.target));
  const timerRows = [...timers].sort((a, b) => a.target.localeCompare(b.target));

  return (
    <section
      aria-labelledby="services-title"
      className="rounded-xl border border-[var(--color-hairline)] bg-white p-4"
    >
      <h2
        id="services-title"
        className="mb-3 flex items-baseline gap-2 text-base font-semibold tracking-tight"
      >
        systemd 서비스 · 타이머
        <span className="font-mono text-xs font-medium tabular-nums text-[var(--color-text-muted)]">
          {svcRows.length + timerRows.length}
        </span>
      </h2>
      {svcRows.length === 0 && timerRows.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">
          checks 수집 대기 중 — 에이전트 WATCH_SERVICES 설정 후 표시됩니다.
        </p>
      ) : (
        <div className="space-y-4">
          {svcRows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-hairline)] text-xs text-[var(--color-text-muted)]">
                    <th className="px-3 py-1.5 text-left font-medium">서비스</th>
                    <th className="px-3 py-1.5 text-left font-medium">상태</th>
                    <th className="px-3 py-1.5 text-right font-medium">재시작</th>
                    <th className="px-3 py-1.5 text-right font-medium">확인</th>
                  </tr>
                </thead>
                <tbody>
                  {svcRows.map((c) => {
                    const s = checkStatusStyle(c.status);
                    const active = detailStr(c, "active");
                    const nRestarts = detailNum(c, "nRestarts");
                    return (
                      <tr
                        key={c.target}
                        className="border-b border-[var(--color-hairline)] last:border-b-0 hover:bg-[var(--color-surface-2)]"
                      >
                        <td className="px-3 py-1.5 font-mono text-xs">{c.target}</td>
                        <td
                          className="px-3 py-1.5 text-xs font-semibold"
                          style={{ color: s.color }}
                        >
                          {s.label}
                          {active != null && active !== "active" && (
                            <span className="ml-1 font-normal text-[var(--color-text-subtle)]">
                              ({active})
                            </span>
                          )}
                        </td>
                        <td
                          className="px-3 py-1.5 text-right text-xs tabular-nums"
                          style={{
                            color:
                              nRestarts != null && nRestarts > 0
                                ? "var(--color-warn)"
                                : "var(--color-text-muted)",
                          }}
                        >
                          {nRestarts ?? "–"}
                        </td>
                        <td className="px-3 py-1.5 text-right text-xs tabular-nums text-[var(--color-text-subtle)]">
                          {formatAgo(c.checkedAt, now)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {timerRows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-hairline)] text-xs text-[var(--color-text-muted)]">
                    <th className="px-3 py-1.5 text-left font-medium">타이머</th>
                    <th className="px-3 py-1.5 text-left font-medium">상태</th>
                    <th className="px-3 py-1.5 text-left font-medium">마지막 실행</th>
                    <th className="px-3 py-1.5 text-left font-medium">다음 예정</th>
                    <th className="px-3 py-1.5 text-left font-medium">결과</th>
                  </tr>
                </thead>
                <tbody>
                  {timerRows.map((c) => {
                    const s = checkStatusStyle(c.status);
                    const last = epochToDate(detailNum(c, "lastTriggerEpoch"));
                    const next = epochToDate(detailNum(c, "nextElapseEpoch"));
                    const result = detailStr(c, "result");
                    return (
                      <tr
                        key={c.target}
                        className="border-b border-[var(--color-hairline)] last:border-b-0 hover:bg-[var(--color-surface-2)]"
                      >
                        <td className="px-3 py-1.5 font-mono text-xs">{c.target}</td>
                        <td
                          className="px-3 py-1.5 text-xs font-semibold"
                          style={{ color: s.color }}
                        >
                          {s.label}
                        </td>
                        <td className="px-3 py-1.5 text-xs tabular-nums text-[var(--color-text-muted)]">
                          {last != null ? formatAgo(last, now) : "–"}
                        </td>
                        <td className="px-3 py-1.5 text-xs tabular-nums text-[var(--color-text-muted)]">
                          {next != null ? formatKstTime(next) : "–"}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-[var(--color-text-muted)]">
                          {result ?? "–"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
