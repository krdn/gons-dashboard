// apps/cron/autopilot/lib.test.js
import { describe, it, expect } from "vitest";
import {
  parseHealthBody,
  shouldDeploy,
  buildDeployArgs,
  parseRunningDigest,
  buildImageRef,
  upsertEnvKey,
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

describe("upsertEnvKey", () => {
  it("기존 키를 in-place 갱신, 다른 줄 보존", () => {
    const env = "FOO=1\nAPP_IMAGE_REF=old\nBAR=2\n";
    expect(upsertEnvKey(env, "APP_IMAGE_REF", "new")).toBe("FOO=1\nAPP_IMAGE_REF=new\nBAR=2\n");
  });
  it("키 없으면 말미에 추가 (개행으로 끝나는 경우)", () => {
    const env = "FOO=1\nBAR=2\n";
    expect(upsertEnvKey(env, "APP_IMAGE_REF", "x")).toBe("FOO=1\nBAR=2\nAPP_IMAGE_REF=x\n");
  });
  it("키 없고 개행으로 안 끝나면 개행 추가 후 키", () => {
    const env = "FOO=1\nBAR=2";
    expect(upsertEnvKey(env, "APP_IMAGE_REF", "x")).toBe("FOO=1\nBAR=2\nAPP_IMAGE_REF=x\n");
  });
  it("다른 키의 값에 동일 prefix 가 있어도 정확히 그 키만 갱신", () => {
    // APP_IMAGE_REF 와 APP_IMAGE_REF_FOO 가 공존해도 ^KEY=$ 앵커로 정확히 매칭
    const env = "APP_IMAGE_REF=old\nAPP_IMAGE_REF_FOO=keep\n";
    expect(upsertEnvKey(env, "APP_IMAGE_REF", "new")).toBe(
      "APP_IMAGE_REF=new\nAPP_IMAGE_REF_FOO=keep\n",
    );
  });
  it("digest 값에 특수문자(@:)가 있어도 그대로 보존", () => {
    const env = "APP_IMAGE_REF=old\n";
    const ref = "ghcr.io/krdn/gons-dashboard@sha256:892d84b9";
    expect(upsertEnvKey(env, "APP_IMAGE_REF", ref)).toBe(`APP_IMAGE_REF=${ref}\n`);
  });
});
