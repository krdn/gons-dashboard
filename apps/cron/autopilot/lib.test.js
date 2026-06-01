// apps/cron/autopilot/lib.test.js
import { describe, it, expect } from "vitest";
import {
  parseHealthBody,
  shouldDeploy,
  buildDeployArgs,
  parseRunningDigest,
  buildImageRef,
} from "./lib.js";

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

describe("parseRunningDigest", () => {
  // docker inspect --format '{{index .RepoDigests 0}}' 출력에서 digest 추출.
  it("RepoDigest 문자열에서 sha256 digest 추출", () => {
    expect(
      parseRunningDigest("ghcr.io/krdn/gons-dashboard@sha256:891e8b44ddf0"),
    ).toBe("sha256:891e8b44ddf0");
  });
  it("digest 없는 ref 면 null (RepoDigests 비어 빈 문자열)", () => {
    expect(parseRunningDigest("")).toBe(null);
  });
  it("@sha256 없는 태그-only ref 면 null", () => {
    expect(parseRunningDigest("ghcr.io/krdn/gons-dashboard:latest")).toBe(null);
  });
});

describe("buildImageRef", () => {
  it("repo@digest 형식의 이미지 ref 생성", () => {
    expect(buildImageRef("ghcr.io/krdn/gons-dashboard", "sha256:892d")).toBe(
      "ghcr.io/krdn/gons-dashboard@sha256:892d",
    );
  });
});
