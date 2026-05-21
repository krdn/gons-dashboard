// StockAnalysisCard 의 Suspense fallback — server component (no "use client").
export function StockAnalysisSkeleton() {
  return (
    <section
      aria-labelledby="stock-analysis-heading"
      aria-busy="true"
      className="col-span-1 max-w-[760px]"
    >
      <h2
        id="stock-analysis-heading"
        className="mb-4 flex items-baseline gap-2 text-base font-semibold tracking-tight text-[var(--color-text)]"
      >
        <span>포트폴리오 분석</span>
        <span className="font-mono text-xs font-medium text-[var(--color-text-muted)]">
          로딩 중…
        </span>
      </h2>
      <div className="flex flex-col gap-3">
        <div className="h-24 animate-pulse rounded-xl bg-[var(--color-surface-2)]" />
        <div className="h-12 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
        <div className="h-12 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
      </div>
    </section>
  );
}
