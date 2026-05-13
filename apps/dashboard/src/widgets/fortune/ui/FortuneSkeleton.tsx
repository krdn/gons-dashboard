export function FortuneSkeleton() {
  return (
    <section
      aria-labelledby="fortune-heading"
      className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] px-5 py-5"
    >
      <h2
        id="fortune-heading"
        className="mb-4 text-base font-semibold text-[var(--color-text-muted)]"
      >
        오늘의 운세
      </h2>
      <div className="flex flex-col gap-3">
        <div className="h-4 w-1/2 animate-pulse rounded bg-[var(--color-surface-2)]" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-[var(--color-surface-2)]" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--color-surface-2)]" />
      </div>
    </section>
  );
}
