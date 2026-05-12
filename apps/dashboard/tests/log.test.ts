// shared/lib/log — 구조화 JSON 한 줄 출력 검증.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger } from "@/shared/lib/log";

describe("logger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("info: console.log 으로 출력, level/scope/event/context 포함", () => {
    logger.info("scope-a", "ev-1", { foo: "bar" });
    expect(logSpy).toHaveBeenCalledOnce();
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(payload.level).toBe("info");
    expect(payload.scope).toBe("scope-a");
    expect(payload.event).toBe("ev-1");
    expect(payload.foo).toBe("bar");
    expect(typeof payload.ts).toBe("string");
  });

  it("warn: console.warn 으로 출력", () => {
    logger.warn("scope-b", "warning", { detail: 1 });
    expect(warnSpy).toHaveBeenCalledOnce();
    const payload = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(payload.level).toBe("warn");
    expect(payload.detail).toBe(1);
  });

  it("error: console.error 로 출력", () => {
    logger.error("scope-c", "boom", { code: 500 });
    expect(errSpy).toHaveBeenCalledOnce();
    const payload = JSON.parse(errSpy.mock.calls[0][0] as string);
    expect(payload.level).toBe("error");
    expect(payload.code).toBe(500);
  });

  it("context 생략 가능 — level/scope/event/ts 만으로도 동작", () => {
    logger.info("scope-d", "minimal");
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(payload.scope).toBe("scope-d");
    expect(payload.event).toBe("minimal");
  });

  it("non-serializable context (BigInt) — 폴백 페이로드 출력", () => {
    logger.warn("scope-e", "bigint", { n: 10n });
    expect(warnSpy).toHaveBeenCalledOnce();
    const payload = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(payload._logger_error).toBe("non-serializable context");
    expect(payload.scope).toBe("scope-e");
    expect(payload.event).toBe("bigint");
  });
});
