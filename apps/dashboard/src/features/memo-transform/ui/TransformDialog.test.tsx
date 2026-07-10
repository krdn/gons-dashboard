// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("../client", () => ({
  transformMemoAction: vi.fn(async () => ({
    kind: "ok",
    content: "변환 결과",
    truncated: false,
  })),
  saveTransformationAction: vi.fn(async () => ({ kind: "ok" })),
}));

import { TransformDialog } from "./TransformDialog";
import { transformMemoAction } from "../client";
import type { Memo } from "@/entities/memo/client";
import type { TransformPresetOption } from "../client";

afterEach(cleanup);

const PRESETS: TransformPresetOption[] = [
  { slug: "tidy", label: "정돈", minInputLen: 1 },
  { slug: "polish", label: "매끄럽게", minInputLen: 20 },
  { slug: "summary", label: "요약", minInputLen: 80 },
  { slug: "structured", label: "구조화", minInputLen: 80 },
  { slug: "todos", label: "할 일 추출", minInputLen: 20 },
  { slug: "journal", label: "일기체", minInputLen: 20 },
  { slug: "email", label: "이메일 초안", minInputLen: 20 },
];

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
    render(
      <TransformDialog
        memo={makeMemo("가".repeat(200))}
        presets={PRESETS}
        existingPresets={[]}
        onClose={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.closest("[inert]")).toBeNull(); // portal 회귀 가드
    expect(PRESETS).toHaveLength(7);
    for (const label of [
      "정돈",
      "매끄럽게",
      "요약",
      "구조화",
      "할 일 추출",
      "일기체",
      "이메일 초안",
    ]) {
      expect(
        screen.getByRole("button", { name: new RegExp(label) }),
      ).toBeTruthy();
    }
  });

  it("minInputLen 미달 프리셋은 비활성", () => {
    render(
      <TransformDialog
        memo={makeMemo("짧은 메모")}
        presets={PRESETS}
        existingPresets={[]}
        onClose={() => {}}
      />,
    );
    expect(
      (screen.getByRole("button", { name: /요약/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: /정돈/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("프리셋 실행 → 편집 가능한 미리보기 textarea", async () => {
    render(
      <TransformDialog
        memo={makeMemo("가".repeat(200))}
        presets={PRESETS}
        existingPresets={[]}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /요약/ }));
    expect(await screen.findByDisplayValue("변환 결과")).toBeTruthy();
  });

  it("이미 저장된 프리셋에 교체 안내를 보여준다", () => {
    render(
      <TransformDialog
        memo={makeMemo("가".repeat(200))}
        presets={PRESETS}
        existingPresets={["summary"]}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/저장됨 — 재생성 시 교체/)).toBeTruthy();
  });

  it("커스텀 프리셋 옵션이 렌더된다", () => {
    const withCustom: TransformPresetOption[] = [
      ...PRESETS,
      { slug: "c-abc12345", label: "코칭", minInputLen: 1 },
    ];
    render(
      <TransformDialog
        memo={makeMemo("가".repeat(200))}
        presets={withCustom}
        existingPresets={[]}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /코칭/ })).toBeTruthy();
  });

  it("truncated:true 응답이면 미리보기에 절단 안내를 표시한다", async () => {
    vi.mocked(transformMemoAction).mockResolvedValueOnce({
      kind: "ok",
      content: "변환 결과",
      truncated: true,
    });
    render(
      <TransformDialog
        memo={makeMemo("가".repeat(200))}
        presets={PRESETS}
        existingPresets={[]}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /요약/ }));
    expect(
      await screen.findByText("원문이 길어 앞부분(4,000자)만 변환되었습니다."),
    ).toBeTruthy();
  });

  it("too-short는 카탈로그 minInputLen 기준으로 판별한다", () => {
    const customThreshold: TransformPresetOption[] = [
      { slug: "tidy", label: "정돈", minInputLen: 500 },
    ];
    render(
      <TransformDialog
        memo={makeMemo("가".repeat(200))}
        presets={customThreshold}
        existingPresets={[]}
        onClose={() => {}}
      />,
    );
    expect(
      (screen.getByRole("button", { name: /정돈/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("프록시 인증에서 사라진 모델은 구체적인 안내를 보여준다", async () => {
    vi.mocked(transformMemoAction).mockResolvedValueOnce({
      kind: "failed",
      reason: "model-unavailable",
    });
    render(
      <TransformDialog
        memo={makeMemo("가".repeat(200))}
        presets={PRESETS}
        existingPresets={[]}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /요약/ }));
    expect(
      await screen.findByText(/현재 프록시 인증으로 사용할 수 없습니다/),
    ).toBeTruthy();
  });
});
