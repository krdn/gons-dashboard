// 로딩 스켈레톤 — 카드와 동일 높이(92px)로 layout shift 방지.
// 와이어프레임의 .skel-row + shimmer 애니메이션.
// prefers-reduced-motion에서 globals.css가 자동으로 0.01ms로 죽임.
// a11y: 상태 텍스트는 role=status 로 announce 하고, 시각 placeholder 만 aria-hidden.
// (sr-only 를 aria-hidden 컨테이너 안에 두면 자손까지 트리에서 빠져 안 읽힌다.)

export function EmailDigestSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <span className="sr-only" role="status">
        불러오는 중
      </span>
      <div className="flex flex-col gap-3" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-[92px] animate-[shimmer_1400ms_linear_infinite] rounded-xl border border-[var(--color-hairline)] bg-gradient-to-r from-[var(--color-surface)] from-0% via-[var(--color-surface-2)] via-50% to-[var(--color-surface)] to-100% bg-[length:200%_100%]"
          />
        ))}
      </div>
    </div>
  );
}
