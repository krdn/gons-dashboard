import { describe, it, expect } from "vitest";
import { EMAIL_SETTINGS_DEFAULTS, REPLY_LANGUAGES } from "./types";

describe("replyLanguage 설정", () => {
  it("기본값은 auto (기존 사용자 불변식)", () => {
    expect(EMAIL_SETTINGS_DEFAULTS.replyLanguage).toBe("auto");
  });
  it("REPLY_LANGUAGES는 5개 옵션", () => {
    expect(REPLY_LANGUAGES).toEqual(["auto", "ko", "en", "ja", "zh"]);
  });
});
