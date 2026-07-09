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

describe("MemoComposer — AI 정리 재시도 (§5)", () => {
  it("정리 안 된 초안(cleanedContent 빈값) 복원 시 [다시 정리]가 보이고, 클릭하면 재정리된다", async () => {
    saveDraft({ rawContent: "음 어 원문", cleanedContent: "", title: "", savedAt: 1 });
    render(<MemoComposer />);
    fireEvent.click(screen.getByRole("button", { name: "복원" }));
    // 복원 직후엔 원문 폴백 상태 — 재시도 affordance 노출
    expect(screen.getByDisplayValue("음 어 원문")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "다시 정리" }));
    // mock 액션이 ok("정리")를 반환 — textarea가 정리본으로 교체되고 버튼은 사라진다
    expect(await screen.findByDisplayValue("정리")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "다시 정리" })).toBeNull();
  });

  it("정리된 초안 복원 시에는 [다시 정리]가 없다", () => {
    saveDraft(draft);
    render(<MemoComposer />);
    fireEvent.click(screen.getByRole("button", { name: "복원" }));
    expect(screen.queryByRole("button", { name: "다시 정리" })).toBeNull();
  });
});
