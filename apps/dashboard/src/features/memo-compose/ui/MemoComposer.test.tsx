// @vitest-environment jsdom
// 승인 전 초안 복원 배너 — 새로고침/이탈 후 초안이 UI에 다시 노출되는지 (Codex P2).
// jsdom엔 SpeechRecognition이 없어 voiceSupported=false — 복원 경로는 녹음 없이
// preview만 렌더해야 하므로 이 환경이 오히려 정확한 회귀 가드가 된다.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("../client", () => ({
  cleanupTranscriptAction: vi.fn(async () => ({ kind: "ok", cleaned: "정리" })),
  createMemoAction: vi.fn(async () => ({ kind: "ok", id: "m1" })),
}));

import { MemoComposer } from "./MemoComposer";
import { saveDraft, clearDraft, loadDraft } from "../lib/memoDraftStorage";

beforeEach(() => {
  clearDraft();
});
afterEach(cleanup);

const draft = { rawContent: "음 어 원문", cleanedContent: "정리된 초안", title: "초안 제목", savedAt: 1234 };

describe("MemoComposer — 초안 복원 배너", () => {
  it("승인 대기 초안이 있으면 배너가 보인다", () => {
    saveDraft(draft);
    render(<MemoComposer />);
    expect(screen.getByText("저장하지 않은 메모 초안이 있습니다.")).toBeTruthy();
  });

  it("초안이 없으면 배너가 없다", () => {
    render(<MemoComposer />);
    expect(screen.queryByText("저장하지 않은 메모 초안이 있습니다.")).toBeNull();
  });

  it("복원 클릭 시 초안 내용으로 미리보기가 열린다", () => {
    saveDraft(draft);
    render(<MemoComposer />);
    fireEvent.click(screen.getByRole("button", { name: "복원" }));
    expect(screen.getByDisplayValue("정리된 초안")).toBeTruthy();
    expect(screen.getByDisplayValue("초안 제목")).toBeTruthy();
    expect(screen.getByRole("button", { name: "승인 · 저장" })).toBeTruthy();
  });

  it("버리기 클릭 시 배너가 사라지고 초안이 삭제된다", () => {
    saveDraft(draft);
    render(<MemoComposer />);
    fireEvent.click(screen.getByRole("button", { name: "버리기" }));
    expect(screen.queryByText("저장하지 않은 메모 초안이 있습니다.")).toBeNull();
    expect(loadDraft()).toBeNull();
  });
});
