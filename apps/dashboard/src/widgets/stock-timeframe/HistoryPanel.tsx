"use client";

import type { TimeframeHistoryItem } from "@/entities/stock-timeframe/client";

export function HistoryPanel({
  items,
  onSelect,
  selectedId,
}: {
  items: TimeframeHistoryItem[];
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  if (items.length === 0) {
    return <p className="text-xs text-slate-400">분석 이력이 없습니다</p>;
  }
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onSelect(item.id)}
            className={`w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-50 ${
              item.id === selectedId ? "bg-blue-50 text-blue-700" : "text-slate-600"
            }`}
          >
            <span className="font-medium">{item.ticker}</span>
            <span className="ml-2 text-slate-400">{item.depth}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
