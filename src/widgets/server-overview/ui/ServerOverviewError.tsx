type Props = { hostName: string; message: string; fetchedAt: string };

export function ServerOverviewError({ hostName, message, fetchedAt }: Props) {
  return (
    <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm">
      <p className="font-semibold text-rose-800">
        🖥 {hostName} — Docker 연결 불가
      </p>
      <p className="mt-1 text-rose-700 break-all">{message}</p>
      <p className="mt-2 text-xs text-rose-600">
        마지막 시도: {new Date(fetchedAt).toLocaleString("ko-KR")}
      </p>
    </section>
  );
}
