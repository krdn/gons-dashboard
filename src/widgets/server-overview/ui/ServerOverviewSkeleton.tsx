export function ServerOverviewSkeleton() {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 h-5 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-4 w-full animate-pulse rounded bg-zinc-100 dark:bg-zinc-900"
          />
        ))}
      </div>
    </section>
  );
}
