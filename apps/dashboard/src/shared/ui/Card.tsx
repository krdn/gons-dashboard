// 공통 카드 표면 프리미티브 — 순수 presentational (이벤트 핸들러 prop 없음 → server·client universal).
// 위계·크기 대비는 소비 위젯 책임. 이 컴포넌트는 surface/hairline 토큰만 제공한다(thin wrapper).
import { type ReactNode } from "react";

interface CardProps {
  as?: "article" | "div";
  padding?: "sm" | "md" | "lg";
  tone?: "default" | "accent" | "dashed";
  className?: string;
  "aria-labelledby"?: string;
  "aria-label"?: string;
  children: ReactNode;
}

const PADDING: Record<NonNullable<CardProps["padding"]>, string> = {
  sm: "p-4",
  md: "p-[var(--space-5)]", // 24px — Tailwind p-5는 기본 20px이라 토큰 이탈
  lg: "p-6",
};

const TONE: Record<NonNullable<CardProps["tone"]>, string> = {
  default: "border-[var(--color-hairline)] bg-[var(--color-surface)]",
  accent:
    "border-[var(--color-hairline)] bg-[var(--color-surface)] ring-1 ring-[var(--color-accent)]/20",
  dashed:
    "border-dashed border-[var(--color-hairline-strong)] bg-[var(--color-surface)]",
};

export function Card({
  as = "div",
  padding = "md",
  tone = "default",
  className = "",
  children,
  ...a11y
}: CardProps) {
  const Tag = as;
  const cls = ["rounded-xl border", TONE[tone], PADDING[padding], className]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag className={cls} {...a11y}>
      {children}
    </Tag>
  );
}
