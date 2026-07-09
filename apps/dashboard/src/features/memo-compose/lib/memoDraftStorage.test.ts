// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { saveDraft, loadDraft, clearDraft } from "./memoDraftStorage";

beforeEach(() => localStorage.clear());

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
