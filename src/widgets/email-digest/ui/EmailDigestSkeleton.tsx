// 로딩 스켈레톤 — 카드와 동일 높이(92px)로 layout shift 방지.
// 와이어프레임의 .skel-row + shimmer 애니메이션.
// prefers-reduced-motion에서 globals.css가 자동으로 0.01ms로 죽임.

export function EmailDigestSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <span className="sr-only">불러오는 중</span>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="h-[92px] animate-[shimmer_1400ms_linear_infinite] rounded-xl border border-[var(--color-hairline)] bg-gradient-to-r from-[var(--color-surface)] from-0% via-[var(--color-surface-2)] via-50% to-[var(--color-surface)] to-100% bg-[length:200%_100%]"
        />
      ))}
    </div>
  );
}
