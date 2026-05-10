import { describe, it, expect } from "vitest";
import { isAdmin } from "@/features/container-actions/lib/isAdmin";

describe("isAdmin", () => {
  it("ADMIN_EMAILS에 정확히 매칭되면 true", () => {
    expect(isAdmin("krdn.net@gmail.com", "krdn.net@gmail.com,other@example.com")).toBe(true);
    expect(isAdmin("other@example.com", "krdn.net@gmail.com,other@example.com")).toBe(true);
  });

  it("매칭 안 되면 false", () => {
    expect(isAdmin("intruder@example.com", "krdn.net@gmail.com")).toBe(false);
  });

  it("email이 null이면 false", () => {
    expect(isAdmin(null, "krdn.net@gmail.com")).toBe(false);
    expect(isAdmin(undefined, "krdn.net@gmail.com")).toBe(false);
  });

  it("화이트스페이스 trim", () => {
    expect(isAdmin("a@b.com", " a@b.com , c@d.com ")).toBe(true);
  });

  it("케이스 인센서티브", () => {
    expect(isAdmin("Krdn.NET@gmail.com", "krdn.net@gmail.com")).toBe(true);
  });
});
