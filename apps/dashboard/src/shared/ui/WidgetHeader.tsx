// 위젯 헤더 DRY 단위 — 제목 + count(tabular-nums 배지) + meta + 우측 액션 슬롯.
// headerSlot은 element prop(import 아님) → client 컴포넌트 주입해도 Gotcha #7 무관.
import { type ReactNode } from "react";

interface WidgetHeaderProps {
  title: string;
  titleId: string;
  count?: number;
  meta?: string;
  headerSlot?: ReactNode;
  children?: ReactNode;
}

export function WidgetHeader({
  title,
  titleId,
  count,
  meta,
  headerSlot,
  children,
}: WidgetHeaderProps) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2
        id={titleId}
        className="flex items-baseline gap-2 text-base font-semibold tracking-tight text-[var(--color-text)]"
      >
        <span>{title}</span>
        {count !== undefined && (
          <span className="font-mono text-xs font-medium tabular-nums text-[var(--color-text-muted)]">
            {count}
          </span>
        )}
        {meta && (
          <span className="text-xs font-normal text-[var(--color-text-muted)]">
            {meta}
          </span>
        )}
        {children}
      </h2>
      {headerSlot}
    </div>
  );
}
