"use client";
import { MODEL_LABEL, type AgentModel } from "@/entities/agent/client";

// model 별 배지 색 — 추론 위계 시각화.
// opus=강조(accent), sonnet=긍정(ok), haiku=흐림(subtle), inherit=hairline(미지정).
const MODEL_STYLE: Record<AgentModel, string> = {
  opus: "border-[var(--color-accent)] text-[var(--color-accent)]",
  sonnet: "border-[var(--color-severity-ok)] text-[var(--color-severity-ok)]",
  haiku: "border-[var(--color-hairline)] text-[var(--color-text-subtle)]",
  inherit: "border-[var(--color-hairline)] text-[var(--color-text-subtle)]",
};

export function ModelBadge({
  model,
  className = "",
}: {
  model: AgentModel;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-1 text-[10px] font-medium leading-tight ${MODEL_STYLE[model]} ${className}`}
      title={`모델: ${MODEL_LABEL[model]}`}
    >
      {MODEL_LABEL[model]}
    </span>
  );
}
