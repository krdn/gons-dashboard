export function AutopilotSkeleton() {
  return (
    <section className="rounded-xl border border-[var(--color-hairline)] bg-white p-4">
      <div className="mb-3 h-5 w-56 animate-pulse rounded bg-zinc-200" />
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-4 w-full animate-pulse rounded bg-[var(--color-surface-2)]" />
        ))}
      </div>
    </section>
  );
}
