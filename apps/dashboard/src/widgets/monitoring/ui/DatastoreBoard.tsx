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

/** 심층지표 unknown 사유 → 운영자가 읽고 조치할 수 있는 설명. */
const STAT_REASON_LABEL: Record<string, string> = {
  "not-reported": "미보고 (collector env 확인)",
  "no-metrics": "수치 없음 (쿼리 실패)",
  "duplicate-report": "중복 보고 (목록 중복 확인)",
  "not-observed": "관측 불가",
};

/** 심층지표(pgstat/redisstat) 한 줄 요약 — 연결 사용률·메모리. */
function summarizeStat(c: LatestCheck | undefined): string {
  if (!c) return "–";
  if (c.status === "unknown") {
    // unknown 은 이벤트를 발행하지 않으므로 **여기가 유일한 진단 경로**다.
    // 사유를 뭉뚱그리면 운영자가 원인을 확인할 방법이 없다.
    const reason = detailStr(c, "reason");
    if (reason == null) return "관측 불가";
    const known = STAT_REASON_LABEL[reason];
    if (known) return known;
    // exec-failed-rc1 같은 미등록 사유는 원문을 그대로 노출한다.
    return `관측 불가 (${reason})`;
  }
  const pct = detailNum(c, "usedPct");
  const conns = detailNum(c, "conns");
  const maxConns = detailNum(c, "maxConns");
  const mib = detailNum(c, "memMib");
  if (pct != null && conns != null && maxConns != null) {
    const size = detailNum(c, "sizeBytes");
    const gb = size != null ? ` · ${(size / 1024 ** 3).toFixed(1)}GB` : "";
    return `연결 ${conns}/${maxConns} (${pct}%)${gb}`;
  }
  if (mib != null) return `메모리 ${mib}MiB`;
  return "–";
}

export function DatastoreBoard({
  checks,
  stats = [],
  now,
}: {
  checks: LatestCheck[];
  /** Phase 4 §J 심층지표 — kind pgstat/redisstat. */
  stats?: LatestCheck[];
  now: Date;
}) {
  // PG 먼저, 그 안에서 target 알파벳순 — kind 가 섞이면 같은 이름의 PG/Redis 가
  // 붙어 보여 어느 쪽 판정인지 헷갈린다.
  // liveness 행에 심층지표를 붙인다 — 같은 인스턴스가 두 줄로 갈리면 읽기 어렵다.
  const statOf = new Map(
    stats.map((s) => [`${s.kind === "pgstat" ? "pg" : "redis"}\u0000${s.target}`, s]),
  );
  const rows = [...checks].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.target.localeCompare(b.target),
  );
  // 헤더 배지용 — 지표 이상 건수(liveness 상태 열이 표현하지 못하는 위험).
  // ⚠️ 집계는 **rows 를 기준으로 한 번씩** 순회한다. stats 배열을 직접 세면
  // 행과 매칭되지 않는 stale/orphan stat 이나 중복 보고가 건수를 부풀리거나
  // (미확인 계산에서) 음수를 만든다. 표시되는 행과 헤더가 항상 일치해야 한다.
  const statAlert = rows.reduce(
    (acc, c) => {
      const st = statOf.get(`${c.kind}\u0000${c.target}`);
      if (!st || st.status === "unknown") acc.unknown += 1;
      else if (st.status === "critical") {
        acc.critical += 1;
        acc.total += 1;
      } else if (st.status === "warning") acc.total += 1;
      return acc;
    },
    { critical: 0, total: 0, unknown: 0 },
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
        {/*
          ⚠️ 심층지표의 warning/critical 은 liveness 상태 열에 나타나지 않는다
          (liveness 는 "응답하나"만 본다). 헤더에 건수만 있으면 800MiB 경고가
          떠 있어도 보드 전체가 "12개 정상"으로 읽힌다 — 집계가 실제 판정을
          가리지 않도록 지표 이상 건수를 헤더에 노출한다.
        */}
        {statAlert.total > 0 && (
          <span
            className="rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{
              color: statAlert.critical > 0
                ? "var(--color-severity-high)"
                : "var(--color-warn)",
              backgroundColor: "var(--color-surface-2)",
            }}
          >
            지표 이상 {statAlert.total}
          </span>
        )}
        {statAlert.unknown > 0 && (
          <span
            className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-muted)]"
            title="심층지표를 확인하지 못한 인스턴스 — collector env(DATASTORE_CONTAINERS) 확인"
          >
            지표 미확인 {statAlert.unknown}
          </span>
        )}
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
                <th className="px-3 py-1.5 text-left font-medium">지표</th>
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
                    <td className="px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)]">
                      {(() => {
                        const st = statOf.get(`${c.kind}\u0000${c.target}`);
                        const warn =
                          st?.status === "warning" || st?.status === "critical";
                        return (
                          <span
                            style={
                              warn ? { color: checkStatusStyle(st.status).color } : undefined
                            }
                          >
                            {summarizeStat(st)}
                          </span>
                        );
                      })()}
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
