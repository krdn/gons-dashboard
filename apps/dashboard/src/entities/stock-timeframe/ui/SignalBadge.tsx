import type { Signal } from "../model/types";

const SIGNAL_LABEL: Record<Signal, string> = {
  strong_buy: "적극 매수",
  buy: "매수",
  hold: "보유",
  sell: "매도",
  strong_sell: "적극 매도",
};

const SIGNAL_COLOR: Record<Signal, string> = {
  strong_buy: "bg-green-100 text-green-800",
  buy: "bg-emerald-50 text-emerald-700",
  hold: "bg-slate-100 text-slate-600",
  sell: "bg-orange-50 text-orange-700",
  strong_sell: "bg-red-100 text-red-800",
};

export function SignalBadge({ signal, confidence }: { signal: Signal; confidence?: number }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${SIGNAL_COLOR[signal]}`}
    >
      {SIGNAL_LABEL[signal]}
      {confidence != null && <span className="opacity-60">{confidence}%</span>}
    </span>
  );
}
