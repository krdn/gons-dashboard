import { describe, it, expect } from "vitest";
import { currentKstDate } from "./resolveBirthInput";

describe("currentKstDate", () => {
  it("returns YYYY-MM-DD format", () => {
    const date = currentKstDate();
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns KST date — 14:30 UTC = 23:30 KST → same day", () => {
    const utc = new Date("2026-05-20T14:30:00Z");
    expect(currentKstDate(utc)).toBe("2026-05-20");
  });

  it("returns KST date — 15:30 UTC = 00:30 KST next day → +1 day", () => {
    const utc = new Date("2026-05-20T15:30:00Z");
    expect(currentKstDate(utc)).toBe("2026-05-21");
  });

  it("returns KST date — 23:00 KST same day", () => {
    const utc = new Date("2026-05-20T14:00:00Z");
    expect(currentKstDate(utc)).toBe("2026-05-20");
  });
});
