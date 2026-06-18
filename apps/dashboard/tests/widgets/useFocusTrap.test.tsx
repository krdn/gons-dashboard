// @vitest-environment jsdom
// useFocusTrap 순수 계약 — initial focus / 복원 / suspend.
import { afterEach, describe, it, expect } from "vitest";
import { useRef } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useFocusTrap } from "@/widgets/email-digest/lib/useFocusTrap";

afterEach(cleanup);

function TrapHarness({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, { active });
  return (
    <div ref={ref} tabIndex={-1} data-testid="panel">
      <button data-testid="first">first</button>
      <button data-testid="last">last</button>
    </div>
  );
}

describe("useFocusTrap", () => {
  it("활성화 시 첫 포커서블에 focus", () => {
    const { getByTestId } = render(<TrapHarness active={true} />);
    expect(document.activeElement).toBe(getByTestId("first"));
  });

  it("언마운트 시 직전 포커스 요소로 복원", () => {
    // 트랩 밖 트리거 버튼에 먼저 포커스.
    const trigger = document.createElement("button");
    trigger.textContent = "trigger";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(<TrapHarness active={true} />);
    // 트랩이 first로 포커스를 옮김.
    expect(document.activeElement).not.toBe(trigger);

    unmount();
    // 복원.
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("suspend(active=false)면 포커스를 옮기지 않음", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();

    render(<TrapHarness active={false} />);
    // 비활성이면 trap이 포커스를 가로채지 않음.
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("Tab이 마지막 요소에서 첫 요소로 순환", () => {
    const { getByTestId } = render(<TrapHarness active={true} />);
    const last = getByTestId("last");
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(getByTestId("first"));
  });

  it("Shift+Tab이 첫 요소에서 마지막 요소로 순환", () => {
    const { getByTestId } = render(<TrapHarness active={true} />);
    const first = getByTestId("first");
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(getByTestId("last"));
  });
});
