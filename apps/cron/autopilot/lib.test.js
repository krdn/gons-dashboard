// apps/cron/autopilot/lib.test.js
import { describe, it, expect } from "vitest";
import { parseHealthBody, shouldDeploy, buildDeployArgs, buildRollbackArgs } from "./lib.js";

describe("parseHealthBody", () => {
  it("status ok 면 healthy", () => {
    expect(parseHealthBody('{"status":"ok","time":"2026-06-02T00:00:00.000Z"}')).toBe(true);
  });
  it("status error 면 unhealthy", () => {
    expect(parseHealthBody('{"status":"error","message":"db down"}')).toBe(false);
  });
  it("파싱 불가면 unhealthy", () => {
    expect(parseHealthBody("<html>502</html>")).toBe(false);
  });
});

describe("shouldDeploy", () => {
  it("새 sha 가 running 과 다르면 배포", () => {
    expect(shouldDeploy("sha-new", "sha-old", null)).toBe(true);
  });
  it("새 sha 가 running 과 같으면 스킵", () => {
    expect(shouldDeploy("sha-x", "sha-x", null)).toBe(false);
  });
  it("이미 롤백한 sha 는 재배포 안 함", () => {
    expect(shouldDeploy("sha-bad", "sha-old", "sha-bad")).toBe(false);
  });
  it("latest 가 없으면 배포 안 함", () => {
    expect(shouldDeploy(null, "sha-old", null)).toBe(false);
  });
});

describe("buildDeployArgs", () => {
  it("절대경로 -f / --env-file / --no-deps app 을 포함", () => {
    const a = buildDeployArgs("/abs/docker-compose.yml", "/abs/.env");
    expect(a).toEqual([
      "compose", "-f", "/abs/docker-compose.yml", "--env-file", "/abs/.env",
      "up", "-d", "--no-deps", "app",
    ]);
  });
});

describe("buildRollbackArgs", () => {
  it("롤백도 동일 구조 (env 로 APP_IMAGE_TAG 주입)", () => {
    const a = buildRollbackArgs("/abs/docker-compose.yml", "/abs/.env");
    expect(a).toEqual([
      "compose", "-f", "/abs/docker-compose.yml", "--env-file", "/abs/.env",
      "up", "-d", "--no-deps", "app",
    ]);
  });
});
