// 가용성 보드 — 사이트별 HTTP 상태 + SSL D-day 병합 표 (이슈 #323 §E·F).
import "server-only";
import { type LatestCheck } from "@/entities/monitoring/server";
import { formatAgo } from "../lib/format";
import { checkStatusStyle, detailNum, detailStr } from "../lib/checkStatus";

const SSL_WARN_COLOR_DAYS = 14;

export function AvailabilityBoard({
  http,
  ssl,
  now,
}: {
  http: LatestCheck[];
  ssl: LatestCheck[];
  now: Date;
}) {
  const sslByDomain = new Map(ssl.map((c) => [c.target, c]));
  const rows = [...http].sort((a, b) => a.target.localeCompare(b.target));

  return (
    <section
      aria-labelledby="availability-title"
      className="rounded-xl border border-[var(--color-hairline)] bg-white p-4"
    >
      <h2
        id="availability-title"
        className="mb-3 flex items-baseline gap-2 text-base font-semibold tracking-tight"
      >
        웹 가용성 · SSL
        <span className="font-mono text-xs font-medium tabular-nums text-[var(--color-text-muted)]">
          {rows.length}
        </span>
      </h2>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">
          HTTP 체크 대기 중 — check-http cron 첫 실행 후 표시됩니다.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-hairline)] text-xs text-[var(--color-text-muted)]">
                <th className="px-3 py-1.5 text-left font-medium">사이트</th>
                <th className="px-3 py-1.5 text-left font-medium">상태</th>
                <th className="px-3 py-1.5 text-right font-medium">응답</th>
                <th className="px-3 py-1.5 text-right font-medium">지연</th>
                <th className="px-3 py-1.5 text-right font-medium">인증서</th>
                <th className="px-3 py-1.5 text-right font-medium">확인</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const s = checkStatusStyle(c.status);
                const httpStatus = detailNum(c, "httpStatus");
                const latencyMs = detailNum(c, "latencyMs");
                const error = detailStr(c, "error");
                const sslCheck = sslByDomain.get(c.target);
                const daysLeft = sslCheck ? detailNum(sslCheck, "daysLeft") : null;
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
                      {error != null && (
                        <span className="ml-1 font-normal text-[var(--color-text-subtle)]">
                          ({error.slice(0, 40)})
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right text-xs tabular-nums text-[var(--color-text-muted)]">
                      {httpStatus ?? "–"}
                    </td>
                    <td className="px-3 py-1.5 text-right text-xs tabular-nums text-[var(--color-text-muted)]">
                      {latencyMs != null ? `${latencyMs}ms` : "–"}
                    </td>
                    <td
                      className="px-3 py-1.5 text-right text-xs tabular-nums"
                      style={{
                        color:
                          daysLeft != null && daysLeft <= SSL_WARN_COLOR_DAYS
                            ? daysLeft <= 7
                              ? "var(--color-severity-high)"
                              : "var(--color-warn)"
                            : "var(--color-text-muted)",
                      }}
                    >
                      {daysLeft == null
                        ? "–"
                        : daysLeft < 0
                          ? "만료됨"
                          : `D-${daysLeft}`}
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
    </section>
  );
}
