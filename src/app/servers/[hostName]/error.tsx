"use client";

type Props = {
  error: Error;
  reset: () => void;
};

export default function Error({ error, reset }: Props) {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <section className="rounded-xl border border-rose-200 bg-rose-50 p-4">
        <h2 className="font-semibold text-rose-800">
          페이지 로드 실패
        </h2>
        <p className="mt-1 break-all text-sm text-rose-700">
          {error.message}
        </p>
        <button
          onClick={reset}
          className="mt-3 rounded border px-3 py-1 text-sm hover:bg-white"
        >
          다시 시도
        </button>
      </section>
    </main>
  );
}
