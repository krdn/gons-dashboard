"use client";

import type { Verdict } from "../client";

interface Props {
  verdict: Verdict;
  score?: string;
  size?: "sm" | "md";
}

const VERDICT_STYLE: Record<Verdict, { bg: string; text: string; label: string }> = {
  BUY: { bg: "bg-emerald-50", text: "text-emerald-700", label: "매수" },
  HOLD: { bg: "bg-amber-50", text: "text-amber-700", label: "보유" },
  SELL: { bg: "bg-rose-50", text: "text-rose-700", label: "매도" },
};

export function ConsensusBadge({ verdict, score, size = "md" }: Props) {
  const s = VERDICT_STYLE[verdict];
  const px = size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-3 py-1 text-xs";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full ${s.bg} ${s.text} ${px} font-semibold`}
      aria-label={`합의: ${s.label}${score ? ` (${score})` : ""}`}
    >
      {s.label}
      {score && <span className="opacity-70 tabular-nums">· {score}</span>}
    </span>
  );
}
