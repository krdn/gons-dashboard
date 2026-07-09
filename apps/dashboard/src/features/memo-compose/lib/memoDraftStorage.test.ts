// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { saveDraft, loadDraft, clearDraft, getDraftSnapshot, subscribeDraft } from "./memoDraftStorage";

beforeEach(() => {
  clearDraft(); // 모듈 캐시 + localStorage 동시 초기화
  localStorage.clear();
});

describe("memoDraftStorage", () => {
  const draft = { rawContent: "원문", cleanedContent: "정리본", title: "제목", savedAt: 1234 };
  it("save → load 왕복", () => {
    saveDraft(draft);
    expect(loadDraft()).toEqual(draft);
  });
  it("초안 없으면 null", () => {
    expect(loadDraft()).toBeNull();
  });
  it("clear 후 null", () => {
    saveDraft(draft);
    clearDraft();
    expect(loadDraft()).toBeNull();
  });
  it("손상된 JSON은 null (throw 안 함)", () => {
    localStorage.setItem("memo-draft-v1", "{not json");
    expect(loadDraft()).toBeNull();
  });
});

describe("draft snapshot/subscribe — 복원 배너용 (useSyncExternalStore)", () => {
  const draft = { rawContent: "원문", cleanedContent: "정리본", title: "제목", savedAt: 1234 };
  it("save 후 스냅샷은 동일 참조를 반환한다 (렌더 루프 방지)", () => {
    saveDraft(draft);
    expect(getDraftSnapshot()).toBe(getDraftSnapshot());
    expect(getDraftSnapshot()).toEqual(draft);
  });
  it("save/clear 시 구독자에게 알린다", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDraft(listener);
    saveDraft(draft);
    expect(listener).toHaveBeenCalledTimes(1);
    clearDraft();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getDraftSnapshot()).toBeNull();
    unsubscribe();
    saveDraft(draft);
    expect(listener).toHaveBeenCalledTimes(2); // 구독 해제 후 미호출
  });
});
