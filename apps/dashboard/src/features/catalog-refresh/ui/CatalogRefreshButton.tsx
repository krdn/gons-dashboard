// 카탈로그 재생성 버튼 — dev 전용 client 컴포넌트.
// 클릭 시 refreshCatalog Server Action 을 호출해 ~/.claude 를 다시 스캔한다.
// 운영에서는 소스가 없어 렌더하지 않는다 (NODE_ENV 빌드 시점 인라인).
"use client";

import { useState, useTransition } from "react";

import { refreshCatalog } from "../client";
import type { CatalogKind, RefreshResult } from "../model/types";

interface CatalogRefreshButtonProps {
  kind: CatalogKind;
}

export function CatalogRefreshButton({ kind }: CatalogRefreshButtonProps) {
  // hook 은 항상 최상단에서 무조건 호출 (Rules of Hooks). 운영 가드는 hook 뒤 early return.
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<RefreshResult | null>(null);

  // 운영 렌더 가드 — NODE_ENV 는 빌드 시점 인라인. 소스 ~/.claude 없어 버튼 무의미.
  if (process.env.NODE_ENV === "production") return null;

  const onClick = () => {
    setResult(null);
    startTransition(async () => {
      const r = await refreshCatalog(kind);
      setResult(r);
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="rounded-md border border-[var(--color-hairline)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--color-surface-2)] disabled:opacity-50"
      >
        {isPending ? "재생성 중…" : "카탈로그 새로고침"}
      </button>
      {result?.ok && (
        <div className="max-w-xs text-right text-xs text-[var(--color-text-muted)]">
          <p>
            생성 {result.count ?? "?"}개 완료.
          </p>
          <p className="mt-0.5">{result.warning}</p>
          <p className="mt-0.5">즉시 반영이 안 되면 dev 서버 재시작이 필요할 수 있습니다.</p>
        </div>
      )}
      {result && !result.ok && (
        <p className="max-w-xs text-right text-xs text-[var(--color-severity-high)]">
          {result.error}
        </p>
      )}
    </div>
  );
}
