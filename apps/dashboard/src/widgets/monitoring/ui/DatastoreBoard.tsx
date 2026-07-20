// 데이터스토어 liveness 보드 (이슈 #323 §G, Phase 3).
//
// 표시 원칙은 SecurityBoard 와 동일 — unknown("관찰 불가")을 회색으로 뚜렷이
// 구분한다. 다만 여기선 unknown 사유가 운영 조치와 직결되므로(포트 미노출은
// 정상, 낡은 env 는 조치 필요) 사유를 사람 말로 풀어 보여준다.
import "server-only";
import { type LatestCheck } from "@/entities/monitoring/server";
import { formatAgo } from "../lib/format";
import { checkStatusStyle, detailNum, detailStr } from "../lib/checkStatus";

/** unknown 사유 → 운영자가 읽고 바로 판단할 수 있는 설명. */
const REASON_LABEL: Record<string, string> = {
  "not-exposed": "포트 미노출 (설계상 점검 불가)",
  "not-reported": "에이전트가 보고하지 않음 (env 확인)",
  "spec-mismatch": "점검 포트 불일치 (env 확인)",
  "duplicate-report": "동일 대상 중복 보고 (DATASTORE_SPECS 중복 확인)",
  "nc-missing": "프로브 도구 없음",
  "no-result": "결과 누락",
};

function summarize(c: LatestCheck): string {
  if (c.status === "unknown") {
    const reason = detailStr(c, "reason");
    if (reason == null) return "관측 불가";
    const readable = REASON_LABEL[reason] ?? reason;
    // 포트 불일치는 두 값을 나란히 보여야 어느 쪽이 낡았는지 판단된다.
    if (reason === "spec-mismatch") {
      const exp = detailNum(c, "expectedPort");
      const got = detailNum(c, "reportedPort");
      if (exp != null && got != null) return `${readable}: 기대 ${exp} / 보고 ${got}`;
    }
    return readable;
  }
  const port = detailNum(c, "port");
  const at = port != null ? `127.0.0.1:${port}` : "";
  return c.status === "ok" ? `응답 정상 ${at}`.trim() : `응답 없음 ${at}`.trim();
}

export function DatastoreBoard({
  checks,
  now,
}: {
  checks: LatestCheck[];
  now: Date;
}) {
  // PG 먼저, 그 안에서 target 알파벳순 — kind 가 섞이면 같은 이름의 PG/Redis 가
  // 붙어 보여 어느 쪽 판정인지 헷갈린다.
  const rows = [...checks].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.target.localeCompare(b.target),
  );

  return (
    <section
      aria-labelledby="datastore-title"
      className="rounded-xl border border-[var(--color-hairline)] bg-white p-4"
    >
      <h2
        id="datastore-title"
        className="mb-3 flex items-baseline gap-2 text-base font-semibold tracking-tight"
      >
        데이터스토어
        <span className="font-mono text-xs font-medium tabular-nums text-[var(--color-text-muted)]">
          {rows.length}
        </span>
      </h2>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">
          점검 대기 중 — 에이전트에 DATASTORE_SPECS 설정 후 표시됩니다.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-hairline)] text-xs text-[var(--color-text-muted)]">
                <th className="px-3 py-1.5 text-left font-medium">인스턴스</th>
                <th className="px-3 py-1.5 text-left font-medium">종류</th>
                <th className="px-3 py-1.5 text-left font-medium">상태</th>
                <th className="px-3 py-1.5 text-left font-medium">요약</th>
                <th className="px-3 py-1.5 text-right font-medium">확인</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const s = checkStatusStyle(c.status);
                return (
                  <tr
                    key={`${c.kind}:${c.target}`}
                    className="border-b border-[var(--color-hairline)] last:border-b-0 hover:bg-[var(--color-surface-2)]"
                  >
                    <td className="px-3 py-1.5 text-xs">{c.target}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px] uppercase text-[var(--color-text-subtle)]">
                      {c.kind}
                    </td>
                    <td
                      className="px-3 py-1.5 text-xs font-semibold"
                      style={{ color: s.color }}
                    >
                      {s.label}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)]">
                      {summarize(c)}
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
