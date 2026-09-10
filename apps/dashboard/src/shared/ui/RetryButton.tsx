"use client";
export function RetryButton() {
  return (
    <button
      type="button"
      className="hub-text-link"
      onClick={() => window.location.reload()}
    >
      다시 조회 →
    </button>
  );
}
