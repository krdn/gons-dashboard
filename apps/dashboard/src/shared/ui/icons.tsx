// 라인 아이콘 셋 — lucide 스타일 (24x24 viewBox, strokeWidth=2, rounded join/cap).
// 외부 의존성 없이 inline SVG 로 표현. HelpHint.tsx, ExternalLinkIcon 패턴 동일.
//
// 사용 가이드:
//   <Icon size={14} className="text-[var(--color-severity-ok)]" />
//   - currentColor 로 stroke 가 그려지므로 부모 text-* 가 색을 결정한다.
//   - 텍스트 라벨이 함께 있을 때는 aria-hidden 으로 노출 차단.
//   - 아이콘만 있는 버튼은 호출부에서 aria-label 을 직접 지정.

type IconProps = {
  size?: number;
  className?: string;
};

function svgProps(size: number) {
  return {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

export function PlayIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function RestartIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

export function StopIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <rect x="5" y="5" width="14" height="14" rx="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PinIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M12 17v5" />
      <path d="M9 10.76V4.5a2.5 2.5 0 0 1 5 0v6.26a2 2 0 0 0 .87 1.65l1.46.93a2 2 0 0 1 .92 1.69V17H4.75v-1.97a2 2 0 0 1 .92-1.69l1.46-.93A2 2 0 0 0 9 10.76Z" />
    </svg>
  );
}

export function CheckIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function WarningIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="m10.29 3.86-8.18 14.15A2 2 0 0 0 3.83 21h16.34a2 2 0 0 0 1.72-2.99L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </svg>
  );
}

export function ArrowLeftIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

export function HomeIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  );
}

export function ChartIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M3 3v18h18" />
      <path d="M7 14l3-3 3 3 4-5" />
    </svg>
  );
}

export function SkillIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6l-8-4z" />
    </svg>
  );
}

export function FortuneIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function TigerIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 10h.01M15 10h.01M9 15c1 1 5 1 6 0" />
    </svg>
  );
}

export function ServerIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <rect x="3" y="4" width="18" height="7" rx="1.5" />
      <rect x="3" y="13" width="18" height="7" rx="1.5" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </svg>
  );
}
