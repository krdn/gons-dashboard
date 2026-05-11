"use client";

// 도움말 패널 — 키보드 단축키 + 정렬 규칙 + 컨테이너 상태 범례.
// "?" 단축키로 토글, Esc 또는 우상단 X 로 닫음.

interface HelpPanelProps {
  onClose: () => void;
}

export function HelpPanel({ onClose }: HelpPanelProps) {
  return (
    <section
      role="dialog"
      aria-label="키보드 단축키 도움말"
      className="rounded-xl border border-[var(--color-hairline)] bg-white p-4 shadow-sm"
    >
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            키보드 단축키 & 도움말
          </h2>
          <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
            이 페이지는 30초마다 자동 새로고침됩니다. 즉시 갱신하려면 새로고침
            버튼이나 <Kbd>r</Kbd>.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="도움말 닫기"
          className="rounded-md border border-[var(--color-hairline)] px-2 py-1 text-xs text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
        >
          닫기 (Esc)
        </button>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-2 text-xs text-[var(--color-text-muted)] sm:grid-cols-2">
        <ShortcutRow keys={["/"]} desc="검색창에 포커스" />
        <ShortcutRow keys={["r"]} desc="지금 새로고침" />
        <ShortcutRow keys={["?"]} desc="이 도움말 토글" />
        <ShortcutRow keys={["Esc"]} desc="도움말 닫기 · 검색어 지우기" />
      </dl>
      <div className="mt-3 border-t border-[var(--color-hairline)] pt-3 text-xs text-[var(--color-text-muted)]">
        <p className="font-medium text-[var(--color-text)]">정렬 규칙</p>
        <p className="mt-1 leading-relaxed">
          이슈가 있는 프로젝트를 최상단에 노출하고, 그다음 pinned · 이름순으로
          정렬합니다. <span className="font-mono">standalone</span> (compose
          라벨 없음) 그룹은 항상 최하단에 표시됩니다.
        </p>
        <p className="mt-2 font-medium text-[var(--color-text)]">컨테이너 상태</p>
        <p className="mt-1 leading-relaxed">
          <Badge>running</Badge>: 정상 동작 ·{" "}
          <Badge tone="warn">restarting</Badge>: 재시작 중 ·{" "}
          <Badge tone="err">exited</Badge>: 종료 ·{" "}
          <Badge tone="err">dead</Badge>: 비정상 종료 ·{" "}
          <Badge tone="neutral">paused</Badge>: 일시정지
        </p>
      </div>
    </section>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded border border-zinc-300 bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-tiny text-[var(--color-text-muted)] shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      {children}
    </kbd>
  );
}

function ShortcutRow({ keys, desc }: { keys: string[]; desc: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-[var(--color-surface-2)] px-2 py-1.5">
      <span className="flex items-center gap-1">
        {keys.map((k) => (
          <Kbd key={k}>{k}</Kbd>
        ))}
      </span>
      <span>{desc}</span>
    </div>
  );
}

function Badge({
  children,
  tone = "ok",
}: {
  children: React.ReactNode;
  tone?: "ok" | "warn" | "err" | "neutral";
}) {
  const cls =
    tone === "ok"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "warn"
        ? "bg-[oklch(96%_0.04_70)] text-[var(--color-warn)]"
        : tone === "err"
          ? "bg-[oklch(96%_0.04_28)] text-[var(--color-severity-high)]"
          : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]";
  return (
    <span
      className={
        "inline-flex rounded px-1.5 py-0.5 font-mono text-tiny font-medium " +
        cls
      }
    >
      {children}
    </span>
  );
}
