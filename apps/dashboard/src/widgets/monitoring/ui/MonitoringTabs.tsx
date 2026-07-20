"use client";

// /monitoring 탭 셸 — 인프라 | GitHub (이슈 #323).
//
// nav 트리(shared/config/navigation.ts)는 건드리지 않는다. 관제는 고빈도
// operational 조회라 top-level leaf 로 유지하고, 하위 구분만 여기서 한다.
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/monitoring", label: "인프라" },
  { href: "/monitoring/github", label: "GitHub" },
] as const;

export function MonitoringTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 border-b border-[var(--color-hairline)]">
      {TABS.map((tab) => {
        // 정확 일치 — prefix 매칭을 쓰면 /monitoring/github 에서
        // 인프라 탭까지 활성으로 남는다.
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "border-b-2 border-[var(--color-accent)] px-4 py-2 text-sm font-semibold"
                : "px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
