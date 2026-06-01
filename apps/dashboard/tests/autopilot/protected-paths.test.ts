import { describe, it, expect } from "vitest";
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

  it("drizzle 마이그레이션 디렉토리를 보호로 판정", () => {
    expect(matchesProtectedPath(["drizzle/0001_init.sql"])).toBe(true);
  });

  it("secrets 디렉토리를 보호로 판정", () => {
    expect(matchesProtectedPath(["config/secrets/key.json"])).toBe(true);
  });

  it("docker-compose.yml 을 보호로 판정", () => {
    expect(matchesProtectedPath(["docker-compose.yml"])).toBe(true);
  });

  it("health 라우트를 보호로 판정", () => {
    expect(matchesProtectedPath(["apps/dashboard/src/app/api/health/route.ts"])).toBe(true);
  });

  it(".env 파일을 보호로 판정", () => {
    expect(matchesProtectedPath([".env"])).toBe(true);
  });

  it(".env.local 같은 변형도 보호로 판정", () => {
    expect(matchesProtectedPath([".env.local"])).toBe(true);
  });

  it("여러 파일 중 하나만 보호여도 true", () => {
    expect(matchesProtectedPath(["apps/dashboard/src/widgets/ok.tsx", ".github/workflows/ci.yml"])).toBe(true);
  });
});
