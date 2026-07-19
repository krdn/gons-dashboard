// 보안 관제 보드 (이슈 #323 §H, Phase 3) — root collector 관측치 기반.
//
// 표시 원칙: unknown("관찰 불가")을 회색으로 뚜렷이 구분한다. 관측 공백이
// 정상처럼 보이면 방어선이 꺼져 있어도 사용자가 알아채지 못한다.
import "server-only";
import { type LatestCheck } from "@/entities/monitoring/server";
import { formatAgo } from "../lib/format";
import {
  checkStatusStyle,
  detailArr,
  detailNum,
  detailStr,
} from "../lib/checkStatus";

/** kind → 사람이 읽는 항목명. target 은 kind 와 같아 그대로 쓰지 않는다. */
const LABELS: Record<string, string> = {
  iptables: "DOCKER-USER 방화벽",
  fail2ban: "fail2ban",
  ufw: "ufw",
  portdrift: "리스닝 포트",
  sshfail: "SSH 인증 실패",
};

/** 표시 순서 — 심각도·중요도 순. */
const ORDER = ["iptables", "ufw", "fail2ban", "portdrift", "sshfail"];

/** kind별 한 줄 요약 — 숫자보다 "무엇이 문제인지"를 먼저 보여준다. */
function summarize(c: LatestCheck): string {
  if (c.status === "unknown") {
    const reason = detailStr(c, "reason");
    return reason != null ? `관측 불가 (${reason})` : "관측 불가";
  }
  switch (c.kind) {
    case "iptables": {
      const rules = detailNum(c, "ruleCount");
      const expected = detailNum(c, "expectedRuleCount");
      if (c.detail?.present === false) return "체인 없음 — 방어선 소멸";
      if (rules == null) return "–";
      return expected != null && rules !== expected
        ? `${rules}규칙 (기대 ${expected})`
        : `${rules}규칙`;
    }
    case "fail2ban": {
      const missing = detailArr(c, "missing");
      const jails = detailArr(c, "jails");
      if (missing != null && missing.length > 0)
        return `jail 누락: ${missing.join(", ")}`;
      return jails != null ? `${jails.length} jail 활성` : "–";
    }
    case "ufw":
      return c.detail?.active === true ? "활성" : "비활성";
    case "portdrift": {
      const unexpected = detailArr(c, "unexpected");
      const count = detailNum(c, "count");
      if (unexpected != null && unexpected.length > 0)
        return `허용목록 밖 ${unexpected.length}건: ${unexpected.slice(0, 3).join(", ")}`;
      return count != null ? `${count}개 정상` : "–";
    }
    case "sshfail": {
      const n = detailNum(c, "failCount1h");
      return n != null ? `1시간 ${n}회` : "–";
    }
    default:
      return "–";
  }
}

export function SecurityBoard({
  checks,
  now,
}: {
  checks: LatestCheck[];
  now: Date;
}) {
  // target 은 "<host>:<kind>" — 호스트가 여럿이면 같은 kind 가 여러 행으로 온다.
  // 정렬은 호스트 → ORDER(심각도) 순. target 전체를 비교하면 문자열 순서가
  // ORDER 를 덮어써 같은 호스트 안에서도 순서가 깨진다.
  const hostOf = (c: LatestCheck) => c.target.split(":")[0];
  const rows = [...checks].sort(
    (a, b) =>
      hostOf(a).localeCompare(hostOf(b)) ||
      ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind),
  );
  const multiHost = new Set(rows.map(hostOf)).size > 1;

  return (
    <section
      aria-labelledby="security-title"
      className="rounded-xl border border-[var(--color-hairline)] bg-white p-4"
    >
      <h2
        id="security-title"
        className="mb-3 flex items-baseline gap-2 text-base font-semibold tracking-tight"
      >
        보안 관제
        <span className="font-mono text-xs font-medium tabular-nums text-[var(--color-text-muted)]">
          {rows.length}
        </span>
      </h2>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">
          보안 수집 대기 중 — 호스트에 gons-security-collect.timer 설치 후 표시됩니다.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-hairline)] text-xs text-[var(--color-text-muted)]">
                <th className="px-3 py-1.5 text-left font-medium">항목</th>
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
                    key={c.target}
                    className="border-b border-[var(--color-hairline)] last:border-b-0 hover:bg-[var(--color-surface-2)]"
                  >
                    <td className="px-3 py-1.5 text-xs">
                      {LABELS[c.kind] ?? c.kind}
                      {multiHost && (
                        <span className="ml-1.5 font-mono text-[10px] text-[var(--color-text-subtle)]">
                          {hostOf(c)}
                        </span>
                      )}
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
