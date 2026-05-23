// avgCost null/0/NaN/Infinity 시 손익률 계산 불가 — "—" 라벨로 fallback.
export function formatChange(
  curr: number,
  avgCost: number | null,
): { pct: number | null; label: string; color: string } {
  if (avgCost == null || avgCost === 0 || !Number.isFinite(avgCost)) {
    return {
      pct: null,
      label: "—",
      color: "text-[var(--color-text-muted)]",
    };
  }
  const pct = ((curr - avgCost) / avgCost) * 100;
  const sign = pct >= 0 ? "+" : "";
  const color = pct >= 0 ? "text-emerald-700" : "text-rose-700";
  return { pct, label: `${sign}${pct.toFixed(1)}%`, color };
}
