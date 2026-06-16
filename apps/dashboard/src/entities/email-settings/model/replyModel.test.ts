import { describe, it, expect } from "vitest";
import {
  REPLY_MODEL_KEYS,
  REPLY_MODEL_META,
  DEFAULT_REPLY_MODEL_KEY,
  parseReplyModelKey,
} from "./replyModel";

describe("replyModel registry", () => {
  it("기본값은 gemini (추천·검증된 모델)", () => {
    expect(DEFAULT_REPLY_MODEL_KEY).toBe("gemini");
  });

  it("gemini만 recommended=true", () => {
    expect(REPLY_MODEL_META.gemini.recommended).toBe(true);
    expect(REPLY_MODEL_META.codex.recommended).toBe(false);
    expect(REPLY_MODEL_META.claude.recommended).toBe(false);
  });

  it("claude 라벨은 Opus (haiku 아님 — 거절 발생원 제외)", () => {
    expect(REPLY_MODEL_META.claude.label).toContain("Opus");
  });

  it("3개 키 모두 메타 존재", () => {
    for (const k of REPLY_MODEL_KEYS) {
      expect(REPLY_MODEL_META[k].label).toBeTruthy();
      expect(REPLY_MODEL_META[k].vendor).toBeTruthy();
    }
  });

  it("parseReplyModelKey: 유효값 통과", () => {
    expect(parseReplyModelKey("codex")).toBe("codex");
  });

  it("parseReplyModelKey: 잘못된 값은 기본값 폴백", () => {
    expect(parseReplyModelKey("bogus")).toBe("gemini");
    expect(parseReplyModelKey(undefined)).toBe("gemini");
    expect(parseReplyModelKey(42)).toBe("gemini");
  });
});
