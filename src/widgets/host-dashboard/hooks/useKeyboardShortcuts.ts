"use client";

// HostDashboard 의 키보드 단축키:
//   - "/" → 검색 인풋 포커스
//   - "r" / "R" → 새로고침
//   - "?" → 도움말 토글
//   - "Esc" → 도움말 닫기 또는 검색 인풋 비우기
//
// 텍스트 입력 중에는 Esc 만 동작 (검색창 blur + 비움). modifier 키 동반 시 무시.

import { useEffect, type RefObject } from "react";

export interface KeyboardShortcutsParams {
  searchInputRef: RefObject<HTMLInputElement | null>;
  onRefresh: () => void;
  onClearSearch: () => void;
  showHelp: boolean;
  setShowHelp: (next: boolean | ((prev: boolean) => boolean)) => void;
}

export function useKeyboardShortcuts({
  searchInputRef,
  onRefresh,
  onClearSearch,
  showHelp,
  setShowHelp,
}: KeyboardShortcutsParams): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (e.key === "Escape") {
        if (showHelp) {
          setShowHelp(false);
          e.preventDefault();
          return;
        }
        if (isTyping && target instanceof HTMLInputElement) {
          target.blur();
          if (target === searchInputRef.current) onClearSearch();
        }
        return;
      }

      if (isTyping) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;

      if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        onRefresh();
      } else if (e.key === "?") {
        e.preventDefault();
        setShowHelp((prev) => !prev);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchInputRef, onRefresh, onClearSearch, showHelp, setShowHelp]);
}
