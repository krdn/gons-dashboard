// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CopyableCommand } from "./CopyableCommand";

afterEach(cleanup);

describe("CopyableCommand", () => {
  it("명령 문자열을 <code>로 렌더한다", () => {
    render(<CopyableCommand command="pnpm typecheck" />);
    expect(screen.getByText("pnpm typecheck")).toBeTruthy();
  });

  it("복사 버튼 클릭 시 clipboard.writeText를 명령으로 호출한다", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CopyableCommand command="curl ..." />);
    fireEvent.click(screen.getByRole("button", { name: /복사/ }));
    expect(writeText).toHaveBeenCalledWith("curl ...");
  });
});
