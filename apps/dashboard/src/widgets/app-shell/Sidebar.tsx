"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  NAV_TREE,
  type NavLeaf,
  type NavGroup,
} from "@/shared/config/navigation";
import { ChevronRightIcon } from "@/shared/ui/icons";
import { NavIcon } from "./navIcon";

// 현재 경로가 이 잎을 가리키는지 — "/" 는 정확히 일치, 나머지는 prefix
function isLeafActive(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

// 그룹 중 현재 경로의 자식을 품은 그룹 id 집합 (초기 자동 펼침용)
function activeGroupIds(pathname: string): Record<string, boolean> {
  const open: Record<string, boolean> = {};
  for (const node of NAV_TREE) {
    if (node.kind === "group") {
      open[node.id] = node.children.some((c) => isLeafActive(c.href, pathname));
    }
  }
  return open;
}

function leafClassName(active: boolean, indent: boolean): string {
  return `flex items-center gap-3 rounded-lg py-2 text-sm transition-colors ${
    indent ? "pl-9 pr-3" : "px-3"
  } ${
    active
      ? "bg-[var(--color-surface-2)] font-semibold text-[var(--color-text)]"
      : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
  }`;
}

function LeafLink({
  leaf,
  pathname,
  collapsed,
  indent,
}: {
  leaf: NavLeaf;
  pathname: string;
  collapsed: boolean;
  indent: boolean;
}) {
  const active = isLeafActive(leaf.href, pathname);
  return (
    <Link
      href={leaf.href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? leaf.label : undefined}
      className={
        collapsed
          ? leafClassName(active, false)
          : leafClassName(active, indent)
      }
    >
      <NavIcon icon={leaf.icon} className="shrink-0" />
      {!collapsed && <span className="truncate">{leaf.label}</span>}
    </Link>
  );
}

function GroupSection({
  group,
  pathname,
  open,
  onToggle,
}: {
  group: NavGroup;
  pathname: string;
  open: boolean;
  onToggle: () => void;
}) {
  const panelId = `nav-group-${group.id}`;
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)]"
      >
        <NavIcon icon={group.icon} className="shrink-0" />
        <span className="truncate">{group.label}</span>
        <ChevronRightIcon
          size={14}
          className={`ml-auto shrink-0 transition-transform ${
            open ? "rotate-90" : ""
          }`}
        />
      </button>
      {open && (
        <div id={panelId} className="flex flex-col gap-1">
          {group.children.map((leaf) => (
            <LeafLink
              key={leaf.href}
              leaf={leaf}
              pathname={pathname}
              collapsed={false}
              indent
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();
  // 초기 펼침: 현재 경로가 속한 그룹만 열림 (마운트 시 1회 계산)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    activeGroupIds(pathname),
  );

  // 아이콘만 모드: 그룹 헤더는 라벨이 없어 무의미 → 자식 잎을 평탄화해 아이콘만 나열
  if (collapsed) {
    const leaves: NavLeaf[] = NAV_TREE.flatMap((node) =>
      node.kind === "leaf" ? [node] : node.children,
    );
    return (
      <nav aria-label="주요 메뉴" className="flex flex-col gap-1 p-3">
        {leaves.map((leaf) => (
          <LeafLink
            key={leaf.href}
            leaf={leaf}
            pathname={pathname}
            collapsed
            indent={false}
          />
        ))}
      </nav>
    );
  }

  return (
    <nav aria-label="주요 메뉴" className="flex flex-col gap-1 p-3">
      {NAV_TREE.map((node) =>
        node.kind === "leaf" ? (
          <LeafLink
            key={node.href}
            leaf={node}
            pathname={pathname}
            collapsed={false}
            indent={false}
          />
        ) : (
          <GroupSection
            key={node.id}
            group={node}
            pathname={pathname}
            open={openGroups[node.id] ?? false}
            onToggle={() =>
              setOpenGroups((prev) => ({
                ...prev,
                [node.id]: !prev[node.id],
              }))
            }
          />
        ),
      )}
    </nav>
  );
}
