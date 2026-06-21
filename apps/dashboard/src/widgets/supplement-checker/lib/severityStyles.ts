import type { Severity, ActionType, EvidenceLevel } from "@krdn/gons-health";

// severity → 대시보드 디자인 토큰(--color-severity-*) 매핑.
// 원본 ResultCard 의 이모지 라벨을 대시보드 의미론적 색상 체계로 옮긴다.
export const SEVERITY_META: Record<
  Severity,
  { label: string; token: string; dot: string }
> = {
  high: { label: "높음", token: "var(--color-severity-high)", dot: "🔴" },
  medium: { label: "중간", token: "var(--color-severity-med)", dot: "🟡" },
  low: { label: "낮음", token: "var(--color-severity-low)", dot: "⚪" },
};

// 약사 행동 권고 라벨 (원본 ResultCard 와 동일 문구 — 계약 보존)
export const ACTION_LABEL: Record<ActionType, string> = {
  avoid: "권하지 말 것",
  monitor: "모니터링",
  spacing: "복용 간격 두기",
};

export const EVIDENCE_LABEL: Record<EvidenceLevel, string> = {
  강: "강",
  중: "중",
  약: "약",
};
