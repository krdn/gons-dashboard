"use client";

// 모달 focus trap — 마운트 시 첫 포커서블에 focus + 직전 activeElement 저장,
// Tab 순환을 컨테이너 안에 가두고, 언마운트/비활성화 시 원래 요소로 복원.
// WCAG 2.4.3(Focus Order)/2.1.2(No Keyboard Trap 역설 — 의도된 modal trap).
//
// suspend: 자식 모달(SendConfirmDialog)이 열리면 부모 trap이 포커스를 도로
// 끌어당기지 않도록 양보. 한 번에 활성 trap은 하나여야 한다.
import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function getFocusable(container: HTMLElement): HTMLElement[] {
  // 선택자가 disabled/hidden을 이미 거른다. 추가로 [hidden] 조상만 제외.
  // (offsetParent 가시성 체크는 jsdom에서 항상 null이라 안 씀 — 모달 내부
  // 요소는 사실상 항상 가시이므로 속성 기반 필터로 충분.)
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => el.closest("[hidden]") === null);
}

interface FocusTrapOptions {
  /** false면 trap을 일시 중단(자식 모달이 활성일 때). 기본 true. */
  active?: boolean;
}

export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  { active = true }: FocusTrapOptions = {},
) {
  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;

    // 마운트(활성화) 직전 포커스를 기억해 복원에 사용.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // 컨테이너 자체에 포커스 — 첫 포커서블이 있으면 그쪽 우선.
    const focusables = getFocusable(container);
    const initial = focusables[0] ?? container;
    initial.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !container) return;
      const items = getFocusable(container);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (activeEl === last || !container.contains(activeEl)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // 복원 — 여전히 문서에 붙어있는 경우에만.
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [containerRef, active]);
}
