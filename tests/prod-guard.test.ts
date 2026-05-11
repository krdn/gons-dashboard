// scripts/_lib/prodGuard — 운영 DB ack 가드.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { assertProdDbAck, isProdHost } from "@/scripts/_lib/prodGuard";

describe("isProdHost", () => {
  it("192.168.0.5 → true", () => {
    expect(isProdHost("postgres://u:p@192.168.0.5:5440/db")).toBe(true);
  });

  it("gons.krdn.kr → true", () => {
    expect(isProdHost("postgres://u:p@gons.krdn.kr:5432/db")).toBe(true);
  });

  it("localhost → false", () => {
    expect(isProdHost("postgres://u:p@localhost:5999/db")).toBe(false);
  });

  it("127.0.0.1 → false", () => {
    expect(isProdHost("postgres://u:p@127.0.0.1:5999/db")).toBe(false);
  });

  it("잘못된 URL → false (안전 측면, 어차피 connect 실패할 것)", () => {
    expect(isProdHost("not-a-url")).toBe(false);
  });
});

describe("assertProdDbAck", () => {
  let origArgv: string[];
  let origDatabaseUrl: string | undefined;
  let origAckEnv: string | undefined;

  beforeEach(() => {
    origArgv = process.argv;
    origDatabaseUrl = process.env.DATABASE_URL;
    origAckEnv = process.env.I_KNOW_THIS_IS_PROD;
    process.argv = ["node", "script.ts"];
    delete process.env.I_KNOW_THIS_IS_PROD;
  });

  afterEach(() => {
    process.argv = origArgv;
    if (origDatabaseUrl != null) process.env.DATABASE_URL = origDatabaseUrl;
    else delete process.env.DATABASE_URL;
    if (origAckEnv != null) process.env.I_KNOW_THIS_IS_PROD = origAckEnv;
    else delete process.env.I_KNOW_THIS_IS_PROD;
  });

  it("non-prod 호스트 → no-op", () => {
    process.env.DATABASE_URL = "postgres://u:p@localhost:5999/db";
    expect(() => assertProdDbAck("test")).not.toThrow();
  });

  it("prod 호스트 + ack 없음 → throw", () => {
    process.env.DATABASE_URL = "postgres://u:p@192.168.0.5:5440/db";
    expect(() => assertProdDbAck("seed-hosts")).toThrow(/운영 DB/);
  });

  it("prod 호스트 + --i-know-this-is-prod 플래그 → 통과", () => {
    process.env.DATABASE_URL = "postgres://u:p@192.168.0.5:5440/db";
    process.argv = ["node", "script.ts", "--i-know-this-is-prod"];
    expect(() => assertProdDbAck("seed-hosts")).not.toThrow();
  });

  it("prod 호스트 + I_KNOW_THIS_IS_PROD=1 → 통과", () => {
    process.env.DATABASE_URL = "postgres://u:p@gons.krdn.kr:5432/db";
    process.env.I_KNOW_THIS_IS_PROD = "1";
    expect(() => assertProdDbAck("seed-hosts")).not.toThrow();
  });

  it("ack env 가 '1' 외 값 → throw (오타 방어)", () => {
    process.env.DATABASE_URL = "postgres://u:p@192.168.0.5:5440/db";
    process.env.I_KNOW_THIS_IS_PROD = "true"; // 1 만 인정
    expect(() => assertProdDbAck("seed-hosts")).toThrow(/운영 DB/);
  });

  it("DATABASE_URL 미설정 → no-op", () => {
    delete process.env.DATABASE_URL;
    expect(() => assertProdDbAck("test")).not.toThrow();
  });
});
