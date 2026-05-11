// formatTime — locale-free HH:MM:SS 포맷터 (hydration mismatch 방어).
import { describe, it, expect } from "vitest";
import { formatTime } from "@/widgets/host-dashboard/lib/formatTime";

describe("formatTime", () => {
  it("ISO 문자열 → HH:MM:SS (2자리 zero-pad)", () => {
    // 2026-05-11T01:02:03Z 를 KST(+9) 로 변환하면 10:02:03
    const result = formatTime("2026-05-11T01:02:03Z");
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("자정 (00:00:00) zero-padding", () => {
    const result = formatTime("2026-05-11T15:00:00Z"); // KST 00:00 (다음날)
    expect(result).toBe("00:00:00");
  });

  it("잘못된 ISO → '—' 반환 (no throw)", () => {
    expect(formatTime("not-a-date")).toBe("—");
    expect(formatTime("")).toBe("—");
  });

  it("locale 의존성 없음 — 항상 24시간 숫자만", () => {
    const result = formatTime("2026-05-11T15:30:45Z");
    expect(result).not.toMatch(/[a-zA-Z]/); // PM/AM/오전/오후 등 없어야 함
  });
});
