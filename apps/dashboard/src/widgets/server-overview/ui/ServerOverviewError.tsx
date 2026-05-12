type Props = { hostName: string; message: string; fetchedAt: string };

export function ServerOverviewError({ hostName, message, fetchedAt }: Props) {
  return (
    <section className="rounded-xl border border-[var(--color-severity-high)] bg-[oklch(96%_0.04_28)] p-4 text-sm">
      <p className="font-semibold text-[var(--color-severity-high)]">
        🖥 {hostName} — Docker 연결 불가
      </p>
      <p className="mt-1 text-[var(--color-severity-high)] break-all">{message}</p>
      <p className="mt-2 text-xs text-[var(--color-severity-high)]">
        마지막 시도: {new Date(fetchedAt).toLocaleString("ko-KR")}
      </p>
    </section>
  );
}
