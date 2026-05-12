// 로딩 스켈레톤 — 카드 3개 정도의 placeholder.
export function ImportantEmailsSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-2)]"
        />
      ))}
    </div>
  );
}
