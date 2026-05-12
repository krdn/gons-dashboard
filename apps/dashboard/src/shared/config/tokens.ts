// 디자인 토큰 단일 출처 (single source of truth).
// /plan-design-review의 모든 시각 결정은 여기에 집약된다.
// 변경 시 와이어프레임(`~/.gstack/projects/krdn-gons-dashboard/designs/main-dashboard-20260509/wireframe-v1.html`)도 함께 본다.

export const tokens = {
  color: {
    bg: "oklch(98.4% 0.003 264)",
    surface: "oklch(100% 0 0)",
    surface2: "oklch(96.5% 0.003 264)",
    hairline: "oklch(91% 0.005 264)",
    hairlineStrong: "oklch(85% 0.005 264)",
    text: "oklch(20% 0.01 264)",
    textMuted: "oklch(48% 0.01 264)",
    textSubtle: "oklch(62% 0.01 264)",
    accent: "oklch(54% 0.18 256)",
    severityHigh: "oklch(58% 0.19 28)",
    severityMed: "oklch(65% 0.13 70)",
    severityLow: "oklch(60% 0.02 264)",
    severityOk: "oklch(48% 0.13 155)",
    warn: "oklch(56% 0.18 50)",
    focusRing: "oklch(88.2% 0.059 254.128)",
  },
  space: {
    1: "4px",
    2: "8px",
    3: "12px",
    4: "16px",
    5: "24px",
    6: "32px",
    7: "48px",
    8: "64px",
  },
  radius: {
    1: "4px",
    2: "8px",
    3: "12px",
  },
  text: {
    display: "32px",
    h1: "22px",
    h2: "16px",
    body: "14px",
    small: "12px",
    tiny: "11px",
  },
  font: {
    sans: '"Pretendard Variable", Pretendard, "IBM Plex Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  shadow: {
    card: "0 1px 0 rgba(20, 30, 50, 0.04), 0 0 0 1px var(--color-hairline)",
    elev: "0 6px 16px -8px rgba(20, 30, 50, 0.18), 0 0 0 1px var(--color-hairline)",
  },
  motion: {
    durationFast: "150ms",
    durationNormal: "250ms",
    easeOut: "cubic-bezier(0.16, 1, 0.3, 1)",
  },
} as const;

export type Tokens = typeof tokens;
