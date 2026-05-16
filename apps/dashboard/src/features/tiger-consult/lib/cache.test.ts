import { describe, expect, it, vi, beforeEach } from "vitest";

const mockSelect = vi.fn();
const mockInsert = vi.fn();

vi.mock("@/shared/lib/db/client", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mockSelect }) }) }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}));

vi.mock("@/shared/lib/db/schema", () => ({
  playmcpAnalysis: {},
  playmcpYearly: {},
  playmcpDaily: {},
  playmcpCompatibility: {},
}));

beforeEach(() => {
  mockSelect.mockReset();
  mockInsert.mockReset();
});

describe("getOrFetchAnalysis", () => {
  it("DB hit (inputHash 일치): fetcher 호출 안 함", async () => {
    const { getOrFetchAnalysis } = await import("./cache");
    mockSelect.mockResolvedValue([{ profileId: "p1", inputHash: "abc", payload: { result: { x: 1 } } }]);
    const fetcher = vi.fn();
    const validator = vi.fn(() => ({ ok: true }) as const);
    const { payload, fromCache } = await getOrFetchAnalysis({
      profileId: "p1", inputHash: "abc", tool: "1fate-analyze_saju",
      fetcher, validator,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(fromCache).toBe(true);
    expect(payload).toEqual({ result: { x: 1 } });
  });

  it("inputHash 불일치 → fetcher 호출 → UPSERT", async () => {
    const { getOrFetchAnalysis } = await import("./cache");
    mockSelect.mockResolvedValue([{ profileId: "p1", inputHash: "stale", payload: {} }]);
    const fetcher = vi.fn().mockResolvedValue({ result: { fresh: true } });
    const validator = vi.fn(() => ({ ok: true }) as const);
    const { fromCache, payload } = await getOrFetchAnalysis({
      profileId: "p1", inputHash: "fresh-hash", tool: "1fate-analyze_saju",
      fetcher, validator,
    });
    expect(fetcher).toHaveBeenCalled();
    expect(validator).toHaveBeenCalledWith({ result: { fresh: true } });
    expect(fromCache).toBe(false);
    expect(payload).toEqual({ result: { fresh: true } });
  });

  it("validator 실패 → throw, UPSERT 안 함", async () => {
    const { getOrFetchAnalysis } = await import("./cache");
    const { PlayMCPCrossTalkDetectedError } = await import("./errors");
    mockSelect.mockResolvedValue([]);
    const fetcher = vi.fn().mockResolvedValue({ result: { polluted: true } });
    const validator = vi.fn(() => ({ ok: false, reason: "test-reason" }) as const);
    await expect(
      getOrFetchAnalysis({
        profileId: "p1", inputHash: "h", tool: "1fate-analyze_saju",
        fetcher, validator,
      }),
    ).rejects.toBeInstanceOf(PlayMCPCrossTalkDetectedError);
  });
});
