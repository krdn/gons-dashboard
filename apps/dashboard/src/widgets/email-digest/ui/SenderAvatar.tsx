// 발신자 이니셜 아바타. 36x36 원, 중성 회색.
// 와이어프레임 .sender-avatar 와 동일.

interface SenderAvatarProps {
  initials: string;
}

export function SenderAvatar({ initials }: SenderAvatarProps) {
  return (
    <div
      aria-hidden="true"
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--color-hairline)] bg-[var(--color-surface-2)] text-xs font-semibold text-[var(--color-text-muted)] tabular-nums"
    >
      {initials}
    </div>
  );
}
