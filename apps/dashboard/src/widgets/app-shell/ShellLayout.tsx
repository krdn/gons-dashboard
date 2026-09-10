"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { NAV_LEAVES, isNavActive } from "@/shared/config/navigation";
import { Sidebar } from "./Sidebar";
import { QuickNavigation } from "./QuickNavigation";
const COOKIE = "sidebar_collapsed";
export function ShellLayout({
  initialCollapsed,
  children,
  account,
}: {
  initialCollapsed: boolean;
  children: ReactNode;
  account?: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const current =
    NAV_LEAVES.find((item) => isNavActive(item.href, pathname))?.label ??
    "운영 상세";
  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }
  return (
    <div className="hub-shell">
      <a href="#workspace-content" className="hub-skip-link">
        본문으로 건너뛰기
      </a>
      <aside className={`hub-sidebar ${collapsed ? "is-collapsed" : ""}`}>
        <div className="hub-brand-row">
          {!collapsed && (
            <Link href="/" className="hub-brand">
              <span className="hub-brand-mark" aria-hidden="true">
                g.
              </span>
              <span>
                gons<span className="text-accent">.</span>
                <small>WORKSPACE</small>
              </span>
            </Link>
          )}
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
            aria-expanded={!collapsed}
            className="hub-collapse"
          >
            <span aria-hidden="true">{collapsed ? "›" : "‹"}</span>
          </button>
        </div>
        {!collapsed && (
          <div className="hub-workspace-label">
            <span className="hub-avatar" aria-hidden="true">
              G
            </span>
            <div>
              <strong>나의 워크스페이스</strong>
              <span>Build. Learn. Continue.</span>
            </div>
          </div>
        )}
        {!collapsed && <p className="hub-nav-label">WORKSPACE</p>}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Sidebar key={pathname} collapsed={collapsed} />
        </div>
        {!collapsed && (
          <div className="hub-sidebar-note">
            <span className="hub-eyebrow">KNOWLEDGE → ACTION</span>
            <p>
              오늘의 기록이
              <br />
              다음 작업의 시작점.
            </p>
            <Link href="/handoff?template=learning">학습 기록 남기기 ↗</Link>
          </div>
        )}
        <div className="hub-sidebar-footer">
          {!collapsed && <span>개인 워크스페이스</span>}
          {account}
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="hub-topbar">
          <div className="flex items-center gap-3">
            <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
              <Dialog.Trigger
                className="hub-mobile-trigger"
                aria-label="메뉴 열기"
              >
                ☰
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="hub-dialog-overlay" />
                <Dialog.Content className="hub-mobile-drawer">
                  <div className="flex items-center justify-between p-4">
                    <Dialog.Title className="font-bold">
                      gons.workspace
                    </Dialog.Title>
                    <Dialog.Close className="hub-button" aria-label="메뉴 닫기">
                      ×
                    </Dialog.Close>
                  </div>
                  <Dialog.Description className="sr-only">
                    워크스페이스의 모든 메뉴
                  </Dialog.Description>
                  <div
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("a"))
                        setMobileOpen(false);
                    }}
                  >
                    <Sidebar key={pathname} collapsed={false} />
                  </div>
                  <div className="p-4">{account}</div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            <span className="hub-topbar-context">
              워크스페이스 <span aria-hidden="true">/</span>{" "}
              <strong>{current}</strong>
            </span>
          </div>
          <QuickNavigation />
          <Link className="hub-topbar-note" href="/memos">
            + 메모
          </Link>
        </header>
        <div id="workspace-content" tabIndex={-1}>
          {children}
        </div>
        <footer className="hub-app-footer">
          <span>gons.workspace</span>
          <span>프로젝트와 지식이 이어지는 곳</span>
        </footer>
      </div>
    </div>
  );
}
