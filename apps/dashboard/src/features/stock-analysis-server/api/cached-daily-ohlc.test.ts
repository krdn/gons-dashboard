import { describe, expect, it, vi, beforeEach } from "vitest";

// vi.hoisted 로 mock fn 을 factory 평가 시점보다 먼저 초기화한다.
// (top-level const 는 vi.mock factory 가 정적 import 그래프를 평가할 때
//  아직 TDZ 라 "Cannot access 'mockFetch' before initialization" 발생.)
const { mockGet, mockSet, mockFetch } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSet: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("@/shared/lib/redis/client", () => ({
  getRedisClient: () => ({ get: mockGet, set: mockSet }),
}));

vi.mock("@gons/stock-analysis", () => ({
  fetchYahooDailyOHLC: mockFetch,
}));

import { getCachedDailyOHLC } from "./cached-daily-ohlc";

const SAMPLE = [{ date: "2026-04-01", close: 180, volume: 50_000_000 }];

beforeEach(() => {
  mockGet.mockReset();
  mockSet.mockReset();
  mockFetch.mockReset();
  mockSet.mockResolvedValue("OK");
});

describe("getCachedDailyOHLC", () => {
  it("캐시 hit 시 fetch 안 하고 파싱된 값 반환", async () => {
    mockGet.mockResolvedValue(JSON.stringify(SAMPLE));
    const r = await getCachedDailyOHLC("AAPL", "1y");
    expect(r).toEqual(SAMPLE);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("캐시 miss 시 fetch 후 6h TTL 로 저장", async () => {
    mockGet.mockResolvedValue(null);
    mockFetch.mockResolvedValue(SAMPLE);
    const r = await getCachedDailyOHLC("AAPL", "1y");
    expect(r).toEqual(SAMPLE);
    expect(mockFetch).toHaveBeenCalledWith("AAPL", "1y");
    expect(mockSet).toHaveBeenCalledWith(
      "stock:ohlc:AAPL:1y",
      JSON.stringify(SAMPLE),
      "EX",
      21600,
    );
  });

  it("빈 배열은 캐싱하지 않는다 (실패 고착 방지)", async () => {
    mockGet.mockResolvedValue(null);
    mockFetch.mockResolvedValue([]);
    const r = await getCachedDailyOHLC("AAPL", "1y");
    expect(r).toEqual([]);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("Redis get 실패 시 직접 fetch (fail-open)", async () => {
    mockGet.mockRejectedValue(new Error("redis down"));
    mockFetch.mockResolvedValue(SAMPLE);
    const r = await getCachedDailyOHLC("AAPL", "1y");
    expect(r).toEqual(SAMPLE);
    expect(mockFetch).toHaveBeenCalledWith("AAPL", "1y");
  });
});
