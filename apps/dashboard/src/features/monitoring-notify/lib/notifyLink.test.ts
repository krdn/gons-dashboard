import { describe, it, expect } from "vitest";
import { linkForSource } from "./notifyLink";

describe("linkForSource", () => {
  it("github 이벤트는 GitHub 탭으로 보낸다", () => {
    expect(linkForSource("github")).toBe("/monitoring/github");
  });

  it("그 외 소스는 인프라 보드로 보낸다", () => {
    expect(linkForSource("host")).toBe("/monitoring");
    expect(linkForSource("container")).toBe("/monitoring");
    expect(linkForSource("ssl")).toBe("/monitoring");
  });

  it("미지의 소스도 인프라 보드로 폴백한다", () => {
    expect(linkForSource("brand-new-source")).toBe("/monitoring");
  });
});
