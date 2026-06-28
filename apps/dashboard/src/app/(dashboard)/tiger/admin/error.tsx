"use client";

// 운영자 진단 페이지 (/tiger/admin/*) 의 error boundary.
// diagnostics 가 DB / pgcrypto / credentials 조회 실패 시 500 대신
// 운영자에게 직접 에러 메시지 + 재시도 버튼 노출.

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function TigerAdminError({ error, reset }: Props) {
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <h1 className="text-2xl font-bold text-red-700">🐯 진단 페이지 오류</h1>
      <section role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-medium text-red-900">{error.message}</p>
        {error.digest && (
          <p className="mt-2 text-xs text-red-700">digest: {error.digest}</p>
        )}
      </section>
      <section className="rounded-xl border bg-amber-50 p-4 text-sm text-amber-900">
        <p>가능한 원인:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>DB 연결 실패 (DATABASE_URL 또는 네트워크)</li>
          <li>pgcrypto 키 mismatch (PG_ENCRYPTION_KEY 변경 후 기존 row 복호화 불가)</li>
          <li>playmcp_credentials 테이블 누락 (마이그레이션 필요)</li>
        </ul>
      </section>
      <button
        type="button"
        onClick={reset}
        className="rounded bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-700"
      >
        다시 시도
      </button>
    </main>
  );
}
