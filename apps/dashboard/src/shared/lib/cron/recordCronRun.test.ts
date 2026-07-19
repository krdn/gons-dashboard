import { describe, it, expect, vi, beforeEach } from "vitest";

const valuesMock = vi.hoisted(() => vi.fn());
vi.mock("@/shared/lib/db/client", () => ({
  db: { insert: () => ({ values: valuesMock }) },
}));
const warnMock = vi.hoisted(() => vi.fn());
vi.mock("@/shared/lib/log", () => ({
  logger: { warn: warnMock, info: vi.fn(), error: vi.fn() },
}));

import { recordCronRun } from "./recordCronRun";

const record = {
  job: "test-cron",
  startedAt: new Date("2026-07-19T00:00:00+09:00"),
  finishedAt: new Date("2026-07-19T00:00:03+09:00"),
  status: "ok" as const,
  total: 2,
  succeeded: 2,
  failed: 0,
};

describe("recordCronRun", () => {
  beforeEach(() => {
    valuesMock.mockReset().mockResolvedValue(undefined);
    warnMock.mockReset();
  });

  it("durationMs 를 계산해 insert", async () => {
    await recordCronRun(record);
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ job: "test-cron", durationMs: 3000, status: "ok" }),
    );
  });

  it("insert 실패는 swallow + warn (관측 best-effort — 절대 throw 안 함)", async () => {
    valuesMock.mockRejectedValue(new Error("db down"));
    await expect(recordCronRun(record)).resolves.toBeUndefined();
    expect(warnMock).toHaveBeenCalledWith(
      "cron-runs",
      "record-failed",
      expect.objectContaining({ job: "test-cron" }),
    );
  });
});
