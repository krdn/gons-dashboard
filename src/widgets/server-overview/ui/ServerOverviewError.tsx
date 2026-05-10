type Props = { hostName: string; message: string; fetchedAt: string };

export function ServerOverviewError({ hostName, message, fetchedAt }: Props) {
  return (
    <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm dark:border-rose-900 dark:bg-rose-950">
      <p className="font-semibold text-rose-800 dark:text-rose-300">
        🖥 {hostName} — Docker 연결 불가
      </p>
      <p className="mt-1 text-rose-700 dark:text-rose-400 break-all">{message}</p>
      <p className="mt-2 text-xs text-rose-600 dark:text-rose-500">
        마지막 시도: {new Date(fetchedAt).toLocaleString("ko-KR")}
      </p>
    </section>
  );
}
