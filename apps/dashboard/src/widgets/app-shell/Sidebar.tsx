"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/shared/config/navigation";
import { NavIcon } from "./navIcon";

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="주요 메뉴"
      className="flex flex-col gap-1 p-3"
    >
      {NAV_ITEMS.map((item) => {
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            title={collapsed ? item.label : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-[var(--color-surface-2)] font-semibold text-[var(--color-text)]"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
            }`}
          >
            <NavIcon icon={item.icon} className="shrink-0" />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
