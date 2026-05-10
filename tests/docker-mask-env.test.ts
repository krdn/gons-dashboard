import { describe, it, expect } from "vitest";
import { maskEnv } from "@/shared/lib/docker/maskEnv";

describe("maskEnv", () => {
  it.each([
    ["ANTHROPIC_API_KEY", true],
    ["GITHUB_TOKEN", true],
    ["DB_PASSWORD", true],
    ["NEXTAUTH_SECRET", true],
    ["DATABASE_URL", true],
    ["AWS_SECRET_ACCESS_KEY", true],
  ])("민감 키 %s → 마스킹 true", (k, expected) => {
    expect(maskEnv(k)).toBe(expected);
  });

  it.each([
    ["NODE_ENV", false],
    ["PORT", false],
    ["TZ", false],
    ["LANG", false],
  ])("일반 키 %s → 마스킹 false", (k, expected) => {
    expect(maskEnv(k)).toBe(expected);
  });

  it("케이스 인센서티브", () => {
    expect(maskEnv("api_key")).toBe(true);
    expect(maskEnv("Api_Key")).toBe(true);
  });
});
