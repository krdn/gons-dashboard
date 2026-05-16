"use client";

interface TigerErrorPanelProps {
  title?: string;
  body: string;
  showRetry?: boolean;
  onRetry?: () => void;
}

export function TigerErrorPanel({
  title = "호(虎)가 잠시 답을 못 드리고 있어요",
  body,
  showRetry = false,
  onRetry,
}: TigerErrorPanelProps) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <p className="font-medium text-amber-900">🐯 {title}</p>
      <p className="mt-2 text-sm text-amber-800">{body}</p>
      {showRetry && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-700"
        >
          다시 시도
        </button>
      )}
    </div>
  );
}
