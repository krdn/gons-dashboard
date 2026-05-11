// 에러 상태 — 데이터 로드 실패 시 표시 + 새로고침 버튼.
"use client";
export function ImportantEmailsErrorState() {
  return (
    <div
      role="alert"
      className="rounded-lg border border-[var(--color-severity-high)] bg-[oklch(96%_0.04_28)] p-4 text-sm text-rose-900"
    >
      중요 메일을 불러오지 못했습니다.{" "}
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="font-medium underline"
      >
        새로고침
      </button>
    </div>
  );
}
