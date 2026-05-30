import type { TickerSnapshot } from "../model/types";

export function SnapshotCard({ snapshot }: { snapshot: TickerSnapshot }) {
  const { price, fundamentals } = snapshot;
  return (
    <div className="grid grid-cols-2 gap-3 rounded border border-slate-200 p-3 text-sm sm:grid-cols-4">
      <div>
        <p className="text-xs text-slate-400">현재가</p>
        <p className="font-semibold">${price.last.toFixed(2)}</p>
        <p className={price.changePct >= 0 ? "text-green-600" : "text-red-600"}>
          {price.changePct >= 0 ? "+" : ""}
          {price.changePct.toFixed(2)}%
        </p>
      </div>
      <div>
        <p className="text-xs text-slate-400">시총</p>
        <p className="font-semibold">${(fundamentals.marketCap / 1e9).toFixed(1)}B</p>
      </div>
      <div>
        <p className="text-xs text-slate-400">PER</p>
        <p className="font-semibold">{fundamentals.pe?.toFixed(1) ?? "—"}</p>
      </div>
      <div>
        <p className="text-xs text-slate-400">PBR</p>
        <p className="font-semibold">{fundamentals.pb?.toFixed(2) ?? "—"}</p>
      </div>
      {snapshot.warnings.length > 0 && (
        <p className="col-span-full text-xs text-amber-600">⚠ {snapshot.warnings.join(", ")}</p>
      )}
    </div>
  );
}
