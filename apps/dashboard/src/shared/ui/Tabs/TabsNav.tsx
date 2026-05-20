"use client";

// 사주 프로필 outer 탭 nav. WAI-ARIA Tabs Pattern (manual activation):
// - role tablist/tab + aria-selected/aria-controls
// - 방향키 (←/→/Home/End) + roving tabindex (활성 탭만 tabIndex=0)
// - 클릭/Enter/Space 로 active 전환 → URL ?tab=<key> 갱신 (router.replace + scroll 보존)
//
// state-less 컴포넌트 — activeKey 는 부모(page.tsx 서버 분기)가 URL 에서 파싱해 주입.
// 모델 토글의 ?model= 와 같은 URLSearchParams 합성 패턴 사용 — 두 파라미터가 서로를 보존.

import { useRef, type KeyboardEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { panelId, tabId } from "./ids";

export interface TabsNavTab {
  key: string;
  label: string;
}

interface Props {
  tabs: ReadonlyArray<TabsNavTab>;
  activeKey: string;
  ariaLabel: string;
  idPrefix: string;
  paramName?: string;
}

export function TabsNav({
  tabs,
  activeKey,
  ariaLabel,
  idPrefix,
  paramName = "tab",
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const navigateTo = (key: string) => {
    if (key === activeKey) return;
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set(paramName, key);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const focusAndNavigate = (key: string) => {
    buttonRefs.current[key]?.focus();
    navigateTo(key);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = tabs.findIndex((t) => t.key === activeKey);
    if (currentIndex < 0) return;
    switch (event.key) {
      case "ArrowRight": {
        event.preventDefault();
        focusAndNavigate(tabs[(currentIndex + 1) % tabs.length].key);
        break;
      }
      case "ArrowLeft": {
        event.preventDefault();
        focusAndNavigate(
          tabs[(currentIndex - 1 + tabs.length) % tabs.length].key,
        );
        break;
      }
      case "Home": {
        event.preventDefault();
        focusAndNavigate(tabs[0].key);
        break;
      }
      case "End": {
        event.preventDefault();
        focusAndNavigate(tabs[tabs.length - 1].key);
        break;
      }
    }
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="mb-6 flex gap-1 overflow-x-auto border-b border-[var(--color-hairline)] [scrollbar-width:thin]"
    >
      {tabs.map((tab) => {
        const selected = tab.key === activeKey;
        return (
          <button
            key={tab.key}
            ref={(el) => {
              buttonRefs.current[tab.key] = el;
            }}
            type="button"
            role="tab"
            id={tabId(tab.key, idPrefix)}
            aria-selected={selected}
            aria-controls={panelId(tab.key, idPrefix)}
            tabIndex={selected ? 0 : -1}
            onClick={() => navigateTo(tab.key)}
            onKeyDown={handleKeyDown}
            className={
              selected
                ? "flex-shrink-0 border-b-2 border-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--color-text)]"
                : "flex-shrink-0 border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
