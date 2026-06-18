// 로딩 스켈레톤 — 카드 3개 정도의 placeholder.
// a11y: 상태 텍스트는 role=status 로 announce 하고, 시각 placeholder 만 aria-hidden.
// (sr-only 를 aria-hidden 컨테이너 안에 두면 자손까지 트리에서 빠져 안 읽힌다.)
export function ImportantEmailsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <span className="sr-only" role="status">
        불러오는 중
      </span>
      <div className="flex flex-col gap-3" aria-hidden="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-2)]"
          />
        ))}
      </div>
    </div>
  );
}
