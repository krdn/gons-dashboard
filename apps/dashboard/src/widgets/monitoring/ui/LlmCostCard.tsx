// LLM 비용 카드 (이슈 #323 §I) — 사주 한정.
//
// ⚠️ 제목·부제에 집계 범위를 **명시**한다. llm_spend_log 에 기록하는 경로가
// 사주뿐이라 "전체 LLM 비용"으로 읽히면 실제보다 훨씬 적은 값을 전부로 오인한다.
// 이름만 "LLM 비용"인 카드는 그 자체로 오해를 만든다.
import "server-only";
import { type LlmSpendSummary } from "@/entities/monitoring/server";

/** 원화 — 소수점은 노이즈라 반올림, 0 은 "0" 으로. */
function krw(n: number): string {
  return `₩${Math.round(n).toLocaleString("ko-KR")}`;
}

export function LlmCostCard({
  spend,
  budgetKrw,
}: {
  spend: LlmSpendSummary;
  /** 일일 예산 (SAJU_LLM_DAILY_BUDGET_KRW) — 소진률 표시용. */
  budgetKrw?: number;
}) {
  const pct =
    budgetKrw != null && budgetKrw > 0
      ? Math.min(100, Math.round((spend.todayKrw / budgetKrw) * 100))
      : null;
  // 예산 근접은 색으로 먼저 보이게 — 숫자만 있으면 지나친다.
  const barColor =
    pct == null
      ? "var(--color-text-muted)"
      : pct >= 90
        ? "var(--color-severity-high)"
        : pct >= 70
          ? "var(--color-warn)"
          : "var(--color-severity-ok)";

  return (
    <section
      aria-labelledby="llm-cost-title"
      className="rounded-xl border border-[var(--color-hairline)] bg-white p-4"
    >
      <h2
        id="llm-cost-title"
        className="text-base font-semibold tracking-tight"
      >
        LLM 비용{" "}
        <span className="text-xs font-medium text-[var(--color-text-muted)]">
          (사주 한정)
        </span>
      </h2>
      <p className="mt-0.5 mb-3 text-xs text-[var(--color-text-subtle)]">
        DB 기록 경로가 사주뿐이라 이메일·메모·증권 비용은 포함되지 않습니다.
      </p>

      <div className="flex items-baseline gap-6">
        <div>
          <div className="font-mono text-2xl font-semibold tabular-nums">
            {krw(spend.todayKrw)}
          </div>
          <div className="text-xs text-[var(--color-text-muted)]">
            오늘 (KST)
          </div>
        </div>
        <div>
          <div className="font-mono text-lg tabular-nums text-[var(--color-text-muted)]">
            {krw(spend.monthKrw)}
          </div>
          <div className="text-xs text-[var(--color-text-muted)]">이번 달</div>
        </div>
      </div>

      {pct != null && (
        <div className="mt-3">
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]"
            role="img"
            aria-label={`일일 예산 ${pct}% 소진 (${krw(spend.todayKrw)} / ${krw(budgetKrw!)})`}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${pct}%`, backgroundColor: barColor }}
            />
          </div>
          <div className="mt-1 text-xs tabular-nums text-[var(--color-text-subtle)]">
            일일 예산 {krw(budgetKrw!)} 중 {pct}%
          </div>
        </div>
      )}

      {spend.todayByModel.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-[var(--color-hairline)] pt-2">
          {spend.todayByModel.map((m) => (
            <li
              key={m.model}
              className="flex items-baseline justify-between gap-3 text-xs"
            >
              <span className="truncate font-mono text-[var(--color-text-muted)]">
                {m.model}
              </span>
              <span className="shrink-0 tabular-nums text-[var(--color-text-subtle)]">
                {krw(m.krw)} · {m.calls}회
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
