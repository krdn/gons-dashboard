"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { NAV_LEAVES } from "@/shared/config/navigation";
import { NavIcon } from "./navIcon";
export function QuickNavigation() {
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  const matches = NAV_LEAVES.filter((item) =>
    `${item.label} ${item.href}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        setQuery("");
      }}
    >
      <Dialog.Trigger
        className="hub-command-trigger"
        aria-label="빠른 이동 열기"
      >
        <span aria-hidden="true">⌕</span>
        <span>어디로 이동할까요?</span>
        <kbd>Ctrl K</kbd>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="hub-dialog-overlay" />
        <Dialog.Content
          className="hub-command-dialog"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            searchRef.current?.focus();
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <Dialog.Title className="text-lg font-semibold">
              빠른 이동
            </Dialog.Title>
            <Dialog.Close className="hub-button" aria-label="빠른 이동 닫기">
              Esc ×
            </Dialog.Close>
          </div>
          <Dialog.Description className="text-text-muted mt-2 text-sm">
            메뉴 이름으로 찾거나 지식 보관함에서 문서를 검색하세요.
          </Dialog.Description>
          <input
            ref={searchRef}
            className="hub-command-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="프로젝트, 지식, 관제…"
            aria-label="메뉴 검색"
          />
          <nav aria-label="빠른 이동 결과" className="hub-command-results">
            {matches.map((item) => (
              <Dialog.Close asChild key={item.href}>
                <Link href={item.href}>
                  <NavIcon icon={item.icon} />
                  <span>{item.label}</span>
                  <span className="ml-auto" aria-hidden="true">
                    ↗
                  </span>
                </Link>
              </Dialog.Close>
            ))}
            {query.trim() && (
              <Dialog.Close asChild>
                <Link href={`/knowledge?q=${encodeURIComponent(query.trim())}`}>
                  지식에서 “{query}” 검색 →
                </Link>
              </Dialog.Close>
            )}
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
