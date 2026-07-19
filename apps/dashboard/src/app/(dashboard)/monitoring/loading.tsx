// /monitoring 로딩 스켈레톤 — 실제 레이아웃(KPI 4 + 히어로 7:4 + 표 2)을 미러.
export default function MonitoringLoading() {
  return (
    <div aria-hidden className="mx-auto w-full max-w-[1240px] animate-pulse px-6 py-12">
      <div className="mb-8 h-9 w-32 rounded bg-[var(--color-surface-2)]" />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="h-20 rounded-xl border border-[var(--color-hairline)] bg-white"
          />
        ))}
      </div>
      <div className="mb-6 grid gap-6 md:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
        <div className="h-72 rounded-xl border border-[var(--color-hairline)] bg-white" />
        <div className="h-72 rounded-xl border border-[var(--color-hairline)] bg-white" />
      </div>
      <div className="h-48 rounded-xl border border-[var(--color-hairline)] bg-white" />
    </div>
  );
}
