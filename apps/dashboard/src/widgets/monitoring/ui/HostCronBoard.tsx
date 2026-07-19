// 호스트 cron 판정 보드 (이슈 #323 §C-2) — 로그 mtime 기반 "실행 흔적" 판정.
import "server-only";
import { type LatestCheck } from "@/entities/monitoring/server";
import { formatAgo } from "../lib/format";
import { checkStatusStyle, detailNum } from "../lib/checkStatus";

export function HostCronBoard({
  rows,
  now,
}: {
  rows: LatestCheck[];
  now: Date;
}) {
  const sorted = [...rows].sort((a, b) => a.target.localeCompare(b.target));

  return (
    <section
      aria-labelledby="hostcron-title"
      className="rounded-xl border border-[var(--color-hairline)] bg-white p-4"
    >
      <h2
        id="hostcron-title"
        className="mb-3 flex items-baseline gap-2 text-base font-semibold tracking-tight"
      >
        호스트 cron
        <span className="font-mono text-xs font-medium tabular-nums text-[var(--color-text-muted)]">
          {sorted.length}
        </span>
      </h2>
      {sorted.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">
          checks 수집 대기 중 — 에이전트 HOSTCRON_SPECS 설정 후 표시됩니다.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-hairline)] text-xs text-[var(--color-text-muted)]">
                <th className="px-3 py-1.5 text-left font-medium">작업</th>
                <th className="px-3 py-1.5 text-left font-medium">상태</th>
                <th className="px-3 py-1.5 text-right font-medium">로그 갱신</th>
                <th className="px-3 py-1.5 text-right font-medium">기대 주기</th>
                <th className="px-3 py-1.5 text-right font-medium">확인</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const s = checkStatusStyle(c.status);
                const ageMin = detailNum(c, "ageMin");
                const maxAgeMin = detailNum(c, "maxAgeMin");
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
                    <td className="px-3 py-1.5 text-right text-xs tabular-nums text-[var(--color-text-muted)]">
                      {ageMin != null ? `${ageMin}분 전` : "–"}
                    </td>
                    <td className="px-3 py-1.5 text-right text-xs tabular-nums text-[var(--color-text-muted)]">
                      {maxAgeMin != null ? `≤${maxAgeMin}분` : "–"}
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
