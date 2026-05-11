import { describe, it, expect } from "vitest";
import { safeExternalUrl } from "@/shared/lib/url/safeExternalUrl";

describe("safeExternalUrl", () => {
  it("http/https는 정규화된 URL을 반환", () => {
    expect(safeExternalUrl("http://192.168.0.5:3010")).toBe(
      "http://192.168.0.5:3010/",
    );
    expect(safeExternalUrl("https://example.com/path")).toBe(
      "https://example.com/path",
    );
  });

  it("앞뒤 공백은 trim", () => {
    expect(safeExternalUrl("  https://example.com  ")).toBe(
      "https://example.com/",
    );
  });

  it("null/undefined/공백은 null", () => {
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
    expect(safeExternalUrl("")).toBeNull();
    expect(safeExternalUrl("   ")).toBeNull();
  });

  it("javascript: / data: / file: 등 위험 스킴은 차단", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,<script>")).toBeNull();
    expect(safeExternalUrl("file:///etc/passwd")).toBeNull();
  });

  it("URL 파싱 실패는 null", () => {
    expect(safeExternalUrl("not-a-url")).toBeNull();
    expect(safeExternalUrl("://broken")).toBeNull();
  });
});
