"use client";
import type { PluginStatus } from "@/entities/plugin/client";
import { STATUS_LABEL } from "@/entities/plugin/client";

// 상태별 배지 색 — severity 토큰으로 시각 위계.
// 활성=긍정(ok), 휴면=흐림(subtle), 경로없음=경고(high).
const STATUS_STYLE: Record<PluginStatus, string> = {
  active: "border-[var(--color-severity-ok)] text-[var(--color-severity-ok)]",
  dormant: "border-[var(--color-hairline)] text-[var(--color-text-subtle)]",
  missing: "border-[var(--color-severity-high)] text-[var(--color-severity-high)]",
};

const STATUS_GLYPH: Record<PluginStatus, string> = {
  active: "●",
  dormant: "○",
  missing: "⚠",
};

export function PluginStatusBadge({ status }: { status: PluginStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-tight ${STATUS_STYLE[status]}`}
      title={`상태: ${STATUS_LABEL[status]}`}
    >
      <span aria-hidden>{STATUS_GLYPH[status]}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}
