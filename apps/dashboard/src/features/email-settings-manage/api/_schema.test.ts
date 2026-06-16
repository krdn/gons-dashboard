import { describe, it, expect } from "vitest";
import { EmailSettingsInput } from "./_schema";

const valid = {
  replyNeededLimit: "5",
  importantLimit: "10",
  windowDays: "7",
  replySeverityThreshold: "med",
  importantThreshold: "med",
  categories: ["money", "security"],
  llmReplyEnabled: "on",
  llmImportantEnabled: undefined,
  syncIntervalMinutes: "60",
  digestEnabled: "on",
  digestHourKst: "8",
};

describe("EmailSettingsInput", () => {
  it("유효 입력을 파싱하고 타입 변환", () => {
    const r = EmailSettingsInput.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.replyNeededLimit).toBe(5);
      expect(r.data.llmReplyEnabled).toBe(true);
      expect(r.data.llmImportantEnabled).toBe(false); // undefined → false
      expect(r.data.categories).toEqual(["money", "security"]);
    }
  });
  it("windowDays 0은 거부(min 1)", () => {
    expect(EmailSettingsInput.safeParse({ ...valid, windowDays: "0" }).success).toBe(false);
  });
  it("windowDays 91은 거부(max 90)", () => {
    expect(EmailSettingsInput.safeParse({ ...valid, windowDays: "91" }).success).toBe(false);
  });
  it("digestHourKst 24는 거부(max 23)", () => {
    expect(EmailSettingsInput.safeParse({ ...valid, digestHourKst: "24" }).success).toBe(false);
  });
  it("syncIntervalMinutes 45는 거부(허용 목록 외)", () => {
    expect(EmailSettingsInput.safeParse({ ...valid, syncIntervalMinutes: "45" }).success).toBe(false);
  });
  it("잘못된 카테고리 거부", () => {
    expect(EmailSettingsInput.safeParse({ ...valid, categories: ["bogus"] }).success).toBe(false);
  });
  it("빈 카테고리 배열 허용(모두 끔)", () => {
    expect(EmailSettingsInput.safeParse({ ...valid, categories: [] }).success).toBe(true);
  });

  describe("EmailSettingsInput replyLanguage", () => {
    it("유효한 replyLanguage 통과", () => {
      const r = EmailSettingsInput.safeParse({ ...valid, replyLanguage: "en" });
      expect(r.success).toBe(true);
    });

    it("잘못된 replyLanguage 거부", () => {
      const r = EmailSettingsInput.safeParse({ ...valid, replyLanguage: "fr" });
      expect(r.success).toBe(false);
    });

    it("미지정 시 auto 기본값", () => {
      const r = EmailSettingsInput.safeParse(valid);
      expect(r.success && r.data.replyLanguage).toBe("auto");
    });
  });
});
