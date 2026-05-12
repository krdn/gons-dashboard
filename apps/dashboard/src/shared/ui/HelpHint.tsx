// 작은 ⓘ 아이콘 + native tooltip (title 속성).
// 의존성 없이 inline SVG로 표현. 키보드 포커스 가능 (tabIndex=0, aria-label).
type Props = {
  hint: string;
  size?: number;
  className?: string;
};

export function HelpHint({ hint, size = 14, className }: Props) {
  return (
    <span
      role="img"
      tabIndex={0}
      aria-label={hint}
      title={hint}
      className={
        "inline-flex shrink-0 cursor-help items-center text-[var(--color-text-subtle)] hover:text-[var(--color-text-muted)] focus-visible:text-[var(--color-text-muted)] focus-visible:outline-none " +
        (className ?? "")
      }
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
    </span>
  );
}
