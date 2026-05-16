import { describe, expect, it, vi, afterEach } from "vitest";
import { computeKstDate, computeKstYear } from "./kst";

afterEach(() => vi.useRealTimers());

describe("computeKstDate", () => {
  it("UTC 23:00 → KST 다음날", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T23:00:00Z"));
    expect(computeKstDate()).toBe("2026-05-16");
  });

  it("UTC 14:00 → KST 같은 날 23:00", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T14:00:00Z"));
    expect(computeKstDate()).toBe("2026-05-15");
  });
});

describe("computeKstYear", () => {
  it("UTC 2025-12-31 16:00 → KST 2026", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-12-31T16:00:00Z"));
    expect(computeKstYear()).toBe(2026);
  });
});
