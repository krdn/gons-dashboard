"use client";
import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";

const COOKIE = "sidebar_collapsed";

export function ShellLayout({
  initialCollapsed,
  children,
}: {
  initialCollapsed: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    // 1년 유지. Server Action 라운드트립 불요 — 다음 SSR이 이 쿠키로 초기값 결정.
    document.cookie = `${COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <div className="flex min-h-full">
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 border-r border-[var(--color-hairline)] bg-[var(--color-surface)] transition-[width] md:flex md:flex-col ${
          collapsed ? "w-16" : "w-56"
        }`}
      >
        <div className="flex items-center justify-between p-3">
          {!collapsed && (
            <span className="px-2 text-sm font-bold tracking-tight">
              gons<span className="text-[var(--color-accent)]">.</span>
            </span>
          )}
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
            aria-expanded={!collapsed}
            className="rounded p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
          >
            {collapsed ? "›" : "‹"}
          </button>
        </div>
        <Sidebar collapsed={collapsed} />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
