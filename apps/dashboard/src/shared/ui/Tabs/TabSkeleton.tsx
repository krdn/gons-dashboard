// Suspense fallback. force-dynamic 페이지에서 SSR 응답 안에서 즉시 resolved 될 수 있으므로
// 실제 로딩 UX 는 클라이언트 nav 전환 시에만 보임 (의도된 동작).

export function TabSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="mb-8 h-40 animate-pulse rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)]"
    />
  );
}
