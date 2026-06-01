import { describe, it, expect } from "vitest";
// @ts-expect-error — JS 모듈 (타입 선언 없음)
import { matchesProtectedPath, PROTECTED_PATHS } from "../../../../scripts/autopilot/protected-paths.js";

describe("matchesProtectedPath", () => {
  it("워크플로 경로를 보호로 판정", () => {
    expect(matchesProtectedPath([".github/workflows/ci.yml"])).toBe(true);
  });

  it("cron 실행기 경로를 보호로 판정", () => {
    expect(matchesProtectedPath(["apps/cron/autopilot/deploy-watcher.js"])).toBe(true);
  });

  it("schema.ts (DB 마이그레이션) 를 보호로 판정", () => {
    expect(matchesProtectedPath(["apps/dashboard/src/shared/lib/db/schema.ts"])).toBe(true);
  });

  it("일반 위젯 파일은 보호 아님", () => {
    expect(matchesProtectedPath(["apps/dashboard/src/widgets/host-dashboard/ui/Foo.tsx"])).toBe(false);
  });

  it("빈 배열은 보호 아님", () => {
    expect(matchesProtectedPath([])).toBe(false);
  });

  it("PROTECTED_PATHS 는 비어있지 않다", () => {
    expect(PROTECTED_PATHS.length).toBeGreaterThan(0);
  });
});
