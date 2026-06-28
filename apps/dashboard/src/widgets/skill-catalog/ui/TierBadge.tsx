"use client";
import { TIER_LABEL, type SkillTier } from "@/entities/skill/client";

// 등급별 배지 색 — severity 토큰으로 시각 위계.
// 상=긍정(ok), 중=강조(accent), 하=흐림(subtle), 삭제=경고(high), 미평가=hairline.
const TIER_STYLE: Record<SkillTier, string> = {
  high: "border-[var(--color-severity-ok)] text-[var(--color-severity-ok)]",
  medium: "border-[var(--color-accent)] text-[var(--color-accent)]",
  low: "border-[var(--color-hairline)] text-[var(--color-text-subtle)]",
  remove: "border-[var(--color-severity-high)] text-[var(--color-severity-high)]",
  unrated: "border-[var(--color-hairline)] text-[var(--color-text-subtle)]",
};

export function TierBadge({ tier, className = "" }: { tier: SkillTier; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-1 text-[10px] font-medium leading-tight ${TIER_STYLE[tier]} ${className}`}
      title={`필요도: ${TIER_LABEL[tier]}`}
    >
      {TIER_LABEL[tier]}
    </span>
  );
}
