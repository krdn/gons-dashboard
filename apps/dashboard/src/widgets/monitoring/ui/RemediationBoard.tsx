// 자동 복구 시도 보드 — Phase 1 dry-run 로그 검토용 (이슈 #352).
// DB 를 직접 조회해야만 결과가 보이면 아무도 검토하지 않는다는 게 이 보드의 존재
// 이유다. outcome 5종(in_flight/executed/dry_run/skipped/failed) 전부 배지로
// 노출해야 한다 — Phase 1 은 거의 모든 행이 dry_run 이라 이 배지가 빠지면
// 보드가 사실상 비어 보인다.
import "server-only";
import { type RemediationAttemptRow } from "@/entities/monitoring/server";
import { formatAgo, formatKstTime } from "../lib/format";
import { remediationTarget } from "../lib/remediationTarget";

const OUTCOME_STYLE: Record<
  string,
  { color: string; bg: string; label: string; mark: string }
> = {
  in_flight: {
    color: "var(--color-warn)",
    bg: "color-mix(in oklch, var(--color-warn) 12%, white)",
    label: "진행중",
    mark: "…",
  },
  executed: {
    color: "var(--color-severity-ok)",
    bg: "color-mix(in oklch, var(--color-severity-ok) 12%, white)",
    label: "실행됨",
    mark: "✓",
  },
  dry_run: {
    color: "var(--color-accent)",
    bg: "color-mix(in oklch, var(--color-accent) 12%, white)",
    label: "dry-run",
    mark: "◐",
  },
  skipped: {
    color: "var(--color-text-muted)",
    bg: "var(--color-surface-2)",
    label: "스킵",
    mark: "○",
  },
  failed: {
    color: "var(--color-severity-high)",
    bg: "color-mix(in oklch, var(--color-severity-high) 12%, white)",
    label: "실패",
    mark: "✕",
  },
};

function OutcomeBadge({ outcome }: { outcome: string }) {
  const s = OUTCOME_STYLE[outcome] ?? {
    color: "var(--color-text-muted)",
    bg: "var(--color-surface-2)",
    label: outcome,
    mark: "?",
  };
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ color: s.color, backgroundColor: s.bg }}
    >
      <span aria-hidden>{s.mark}</span>
      {s.label}
    </span>
  );
}

function DryRunBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-muted)]">
      dry-run
    </span>
  );
}

/**
 * 배지 범례. 배지는 OutcomeBadge 를 그대로 재사용한다 — 범례를 별도 마크업으로
 * 복제하면 OUTCOME_STYLE 이 바뀔 때 범례만 낡아 도움말이 오독의 원인이 된다.
 *
 * ⚠️ 설명을 고칠 때는 remediation_attempts 의 **쓰기 경로 3개 전부**에 대조한다.
 * 하나만 보고 일반화하면 틀린다 (이 범례에서 실제로 세 번 반복된 실수다):
 *   1. claimAttempt → settleAttempt — 선택된 조치. in_flight 로 시작해
 *      dry_run/executed/failed 로 종결. 중복 억제 없음.
 *   2. recordSkip — 직접 INSERT(settledAt 즉시). skipped 전용이라 in_flight 를
 *      거치지 않고, 6시간 중복 억제는 이 경로에만 있다. 사유는 두 갈래다 —
 *      buildAction 거부(정책 조건 미충족)와 evaluateGuards 거부(조건은 통과했으나
 *      안전장치가 차단): selectActions.ts:37-40 vs :50-53.
 *   3. reapStaleInFlight — 30분 넘은 in_flight 를 failed 로 전환. 모드 무관.
 *
 * failed 는 "실행했으나 실패" 가 아니다 — 실행 전 준비 실패(runCycle.ts:101),
 * 실행 중 실패(:113), 실행 중 예외(:123), 고아 정리(attempts.ts:175) 를 모두
 * 포괄한다. 구분은 reason 필드에만 있다.
 *
 * dry-run 도 claim 과 settle 이 별도 await 라 그 사이 중단되면 dryRun=true 인
 * in_flight 고아가 남고, reapStaleInFlight 는 dryRun 필터가 없어 이를 failed 로
 * 바꾼다. 그 행은 executeAction 에 도달한 적이 없으므로 "실행 여부 불명" 이
 * 아니라 실제 조치가 없었음이 확정이다 — dryRun=true + failed 는 고아 정리뿐.
 */
const LEGEND: readonly { outcome: string; desc: string }[] = [
  {
    outcome: "skipped",
    desc: "조치를 실행하지 않았다 — 정책 조건 미충족이거나, 조건은 맞지만 안전장치(이미 실행 중·지속 시간·시도 상한·쿨다운)가 막은 경우다. 시도 횟수에 산입하지 않으며 실패가 아니다.",
  },
  {
    outcome: "dry_run",
    desc: "조치 대상으로 뽑혔으나 계획만 세웠다. 실제 변경 없음 — 중복 억제가 없어 사이클마다 쌓일 수 있다.",
  },
  { outcome: "executed", desc: "실제 조치가 성공했다." },
  {
    outcome: "failed",
    desc: "조치가 완주하지 못했다. 실행 중 실패, 실행 전 준비 실패(호스트 정보 조회 등), 기록이 끊긴 뒤의 고아 정리가 모두 여기로 들어오므로 어느 쪽인지는 행 아래 사유로 판별한다. dry-run 배지가 함께 붙어 있으면 고아 정리이며 실제 조치는 없었다.",
  },
  {
    outcome: "in_flight",
    desc: "조치가 선택된 시도만 거치는 시작 상태 — 스킵은 이 상태 없이 곧바로 기록된다. dry-run 은 곧바로 종결돼 보일 일이 드물고, 실제 조치는 실행이 끝날 때까지 머문다. 30분 넘게 남아 있으면 프로세스가 죽은 것으로 보고 실패 처리한다.",
  },
];

/**
 * 보드 판독 도움말.
 *
 * "스킵 6건" 을 "6번 실패" 로 읽는 오독이 실제로 발생했다 — 스킵은 회색이고
 * 실패는 빨강이지만, 행이 이벤트×정책으로 곱해져 쌓이면 개수가 먼저 눈에 든다.
 *
 * 수치 출처 (그쪽을 바꾸면 여기도 함께 고친다):
 *   5분 주기  → apps/cron/scheduler.js 의 auto-remediate 스케줄
 *   6시간 억제 → attempts.ts SKIP_DEDUPE_HOURS
 *   30분 고아 → runCycle.ts STALE_IN_FLIGHT_MINUTES
 */
function BoardHelp() {
  // 패널 배경은 흰색을 유지한다 — skipped 배지의 bg 가 --color-surface-2 라,
  // 패널을 같은 토큰으로 칠하면 정작 설명 대상인 배지가 배경에 묻힌다.
  return (
    <details className="mb-3 rounded-lg border border-[var(--color-hairline)] bg-white px-3 py-2">
      <summary className="cursor-pointer text-xs font-semibold text-[var(--color-text-muted)]">
        이 보드 읽는 법
        <span className="ml-1.5 font-medium">— 스킵은 실패가 아닙니다</span>
      </summary>

      <dl className="mt-3 space-y-1.5">
        {LEGEND.map((l) => (
          <div key={l.outcome} className="flex flex-wrap items-baseline gap-2">
            <dt className="shrink-0">
              <OutcomeBadge outcome={l.outcome} />
            </dt>
            <dd className="flex-1 text-xs text-[var(--color-text-muted)]">{l.desc}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 space-y-2 text-xs leading-relaxed text-[var(--color-text-muted)]">
        <p>
          <span className="font-semibold text-[var(--color-text)]">행 수를 시도 횟수로 읽지 않는다.</span>{" "}
          한 사이클은 열려 있는 이벤트마다 등록된 정책을 차례로 대본다. 조치가
          매칭되면 그 이벤트는 거기서 멈추고, 매칭이 없으면 정책마다 스킵 사유가
          한 줄씩 남는다 — 한 사이클에서 이벤트 하나가 만드는 행은 정책마다 최대
          한 줄이다. 이 목록은 최근 50건까지 여러 사이클에 걸쳐 쌓인 것이라, 같은
          대상·정책 조합이 다시 나타날 수 있다. 스킵이 여러 줄인 것은 조치를 여러
          번 시도했다는 뜻이 아니다. <span className="font-semibold text-[var(--color-text)]">다만 실행됨·실패가
          같은 대상에 반복됐다면 그것은 실제 재시도다</span> — 쿨다운이 지나면
          정책별 상한까지 다시 시도하므로, 그 반복은 무시하지 않는다.
        </p>
        <p>
          <span className="font-semibold text-[var(--color-text)]">최신 스킵 행이 오래됐다고 멈춘 것이 아니다.</span>{" "}
          이 보드만으로는 <em>경보가 아직 열려 있는데 기록이 억제된 것</em>과{" "}
          <em>경보가 이미 해소된 것</em>을 구분할 수 없다 — 해소 여부는 이벤트
          타임라인에서 확인한다. 중복 억제는 스킵 행에만 걸린다: 사이클은 5분마다
          돌지만 같은 (대상·정책·사유) 조합의 스킵은 6시간에 한 번만 기록한다.
          도배된 보드는 아무도 검토하지 않기 때문이다. 사유 안의 숫자는 비교 시
          무시하므로 “지속 시간 부족(10분 &lt; 30분)”과 “(15분 &lt; 30분)”은 같은
          사유로 친다. 단 dry-run 과 실제 실행 사이를 오간 직후에는 같은 사유라도
          다시 기록한다 — 모드가 바뀐 순간의 기록이 가장 중요하기 때문이다.
        </p>
        <p>
          <span className="font-semibold text-[var(--color-text)]">“실측값 없이 조치 금지” 계열 사유</span>{" "}
          는 이벤트가 판단 근거를 싣지 않았다는 뜻이다. 이름이나 관례로 추측해
          조치하지 않는 것이 이 자동화의 설계 의도다 — 근거가 없으면 사람에게
          넘긴다.
        </p>
      </div>
    </details>
  );
}

export function RemediationBoard({
  rows,
  now,
}: {
  rows: RemediationAttemptRow[];
  now: Date;
}) {
  return (
    <section
      aria-labelledby="remediation-board-title"
      className="rounded-xl border border-[var(--color-hairline)] bg-white p-4"
    >
      <h2
        id="remediation-board-title"
        className="mb-3 flex items-baseline gap-2 text-base font-semibold tracking-tight"
      >
        자동 복구 시도
        <span className="font-mono text-xs font-medium tabular-nums text-[var(--color-text-muted)]">
          {rows.length}
        </span>
      </h2>
      {/* 목록 밖에 둔다 — 기록이 없을 때야말로 "왜 비었나" 를 설명해야 한다. */}
      <BoardHelp />
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">
          시도 기록 없음 — 아직 조치 대상 이벤트가 없습니다.
        </p>
      ) : (
        <ol className="space-y-2">
          {rows.map((r) => {
            const target = remediationTarget(r.detail);
            return (
              <li
                key={r.id}
                className="rounded-lg border border-[var(--color-hairline)] p-2.5"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <OutcomeBadge outcome={r.outcome} />
                  {/* outcome='dry_run' 은 claimAttempt 가 dryRun=true 로만 넣는다
                      (runCycle.ts) — 항상 같이 붙어 정보량이 0이라 이때는 생략한다. */}
                  {r.dryRun && r.outcome !== "dry_run" && <DryRunBadge />}
                  <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-muted)]">
                    {r.policyId}
                  </span>
                  <span className="ml-auto text-[11px] tabular-nums text-[var(--color-text-subtle)]">
                    {formatKstTime(r.attemptedAt)} · {formatAgo(r.attemptedAt, now)}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-[var(--color-text)]">
                  {r.action}
                  {target && <span className="font-medium"> — {target}</span>}
                </p>
                {/* 대상 식별의 최후 보루 — skip 행은 detail 이 없어 이것만 남는다. */}
                <p className="mt-0.5 font-mono text-[11px] text-[var(--color-text-subtle)]">
                  {r.dedupKey}
                </p>
                {r.reason && (
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                    {r.reason}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
