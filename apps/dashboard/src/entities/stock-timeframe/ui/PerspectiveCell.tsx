import type { PerspectiveSlot } from "../model/types";
import { SignalBadge } from "./SignalBadge";

export function PerspectiveCell({ slot }: { slot: PerspectiveSlot }) {
  if (!slot.ok) {
    return (
      <div className="rounded border border-dashed border-slate-200 p-2 text-xs text-slate-400">
        분석 실패
      </div>
    );
  }
  const p = slot.value;
  return (
    <div className="space-y-1 rounded border border-slate-200 p-2">
      <SignalBadge signal={p.signal} confidence={p.confidence} />
      <p className="line-clamp-3 text-xs text-slate-600">{p.thesis}</p>
    </div>
  );
}
