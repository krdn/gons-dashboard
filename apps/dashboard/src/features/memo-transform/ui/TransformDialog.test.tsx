// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("../client", () => ({
  transformMemoAction: vi.fn(async () => ({ kind: "ok", content: "변환 결과" })),
  saveTransformationAction: vi.fn(async () => ({ kind: "ok" })),
}));

import { TransformDialog } from "./TransformDialog";
import { TRANSFORM_PRESETS } from "../lib/preset-meta";
import type { Memo } from "@/entities/memo/client";

afterEach(cleanup);

function makeMemo(cleaned: string): Memo {
  return {
    id: "m1",
    userId: "u1",
    source: "text",
    title: "제목",
    rawContent: cleaned,
    cleanedContent: cleaned,
    createdAt: new Date("2026-07-09T10:00:00"),
    updatedAt: new Date("2026-07-09T10:00:00"),
  } as Memo;
}

describe("TransformDialog", () => {
  it("프리셋 7종 버튼이 body 포털로 렌더된다 (inert 조상 없음)", () => {
    render(<TransformDialog memo={makeMemo("가".repeat(200))} existingPresets={[]} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.closest("[inert]")).toBeNull(); // portal 회귀 가드
    expect(Object.keys(TRANSFORM_PRESETS)).toHaveLength(7);
    for (const label of ["정돈", "매끄럽게", "요약", "구조화", "할 일 추출", "일기체", "이메일 초안"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it("minInputLen 미달 프리셋은 비활성", () => {
    render(<TransformDialog memo={makeMemo("짧은 메모")} existingPresets={[]} onClose={() => {}} />);
    expect((screen.getByRole("button", { name: /요약/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /정돈/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("프리셋 실행 → 편집 가능한 미리보기 textarea", async () => {
    render(<TransformDialog memo={makeMemo("가".repeat(200))} existingPresets={[]} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /요약/ }));
    expect(await screen.findByDisplayValue("변환 결과")).toBeTruthy();
  });

  it("이미 저장된 프리셋에 교체 안내를 보여준다", () => {
    render(<TransformDialog memo={makeMemo("가".repeat(200))} existingPresets={["summary"]} onClose={() => {}} />);
    expect(screen.getByText(/저장됨 — 재생성 시 교체/)).toBeTruthy();
  });
});
