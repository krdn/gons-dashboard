import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchDartFinancials, _resetCircuitForTest } from "../src/adapters/dart";
import { DartError } from "../src/adapters/dart-types";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const BIZ = JSON.parse(
  readFileSync(join(FIXTURES, "dart-005930-business.json"), "utf-8"),
);
const Q3 = JSON.parse(
  readFileSync(join(FIXTURES, "dart-005930-Q3.json"), "utf-8"),
);
const ALOT = JSON.parse(
  readFileSync(join(FIXTURES, "dart-005930-alot.json"), "utf-8"),
);
const SHARES = JSON.parse(
  readFileSync(join(FIXTURES, "dart-005930-shares.json"), "utf-8"),
);
const NO_DATA = JSON.parse(
  readFileSync(join(FIXTURES, "dart-no-data.json"), "utf-8"),
);

// URL 패턴으로 endpoint 분기 mock — 보고서별로 (fnlttSinglAcnt / alotMatter / stockTotqySttus)
// 응답을 다르게 줄 수 있도록 attempt 단위 nested map.
interface MockSpec {
  fnlttSinglAcnt?: unknown;
  alotMatter?: unknown;
  stockTotqySttus?: unknown;
}

function mockByEndpoint(perAttempt: MockSpec[]): void {
  let attemptIdx = 0;
  const seenInAttempt = new Set<string>();
  vi.spyOn(global, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    let endpoint: keyof MockSpec | null = null;
    if (url.includes("/fnlttSinglAcnt.json")) endpoint = "fnlttSinglAcnt";
    else if (url.includes("/alotMatter.json")) endpoint = "alotMatter";
    else if (url.includes("/stockTotqySttus.json")) endpoint = "stockTotqySttus";
    if (!endpoint) throw new Error(`unexpected url: ${url}`);

    const spec = perAttempt[attemptIdx] ?? perAttempt[perAttempt.length - 1];
    seenInAttempt.add(endpoint);
    if (seenInAttempt.size >= 3) {
      attemptIdx += 1;
      seenInAttempt.clear();
    }
    const body = spec[endpoint] ?? { status: "013", message: "no data" };
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

describe("fetchDartFinancials", () => {
  beforeEach(() => {
    _resetCircuitForTest();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns financials with EPS+DPS+BPS when annual report available on first attempt", async () => {
    mockByEndpoint([
      { fnlttSinglAcnt: BIZ, alotMatter: ALOT, stockTotqySttus: SHARES },
    ]);
    const result = await fetchDartFinancials("005930", "test-key");
    expect(result.krxCode).toBe("005930");
    expect(result.corpCode).toBe("00126380");
    expect(result.reportPeriod).toMatch(/사업보고서$/);
    // EPS from alotMatter "(연결)주당순이익" 보통주 = 4950
    expect(result.eps).toBe(4950);
    // DPS from alotMatter "주당 현금배당금" 보통주 = 1446
    expect(result.annualDPS).toBe(1446);
    // BPS = 자본총계 402_192_070_000_000 / 보통주 distb 5_940_082_550 ≈ 67_708
    expect(result.bps).not.toBeNull();
    expect(result.bps!).toBeGreaterThan(60000);
    expect(result.bps!).toBeLessThan(75000);
    expect(result.revenueTrailing4Q).toBeGreaterThan(0);
    expect(result.opMarginPct).toBeGreaterThan(0);
    expect(result.revenueGrowthYoY).not.toBeNull();
  });

  it("falls back to next attempt when first returns no-data on fnlttSinglAcnt", async () => {
    mockByEndpoint([
      { fnlttSinglAcnt: NO_DATA, alotMatter: NO_DATA, stockTotqySttus: NO_DATA },
      { fnlttSinglAcnt: Q3, alotMatter: NO_DATA, stockTotqySttus: SHARES },
    ]);
    const result = await fetchDartFinancials("005930", "test-key");
    expect(result.reportPeriod).not.toMatch(/사업보고서$/);
    expect(result.annualDPS).toBeNull(); // 분기보고서엔 DPS 없음
    expect(result.revenueTrailing4Q).toBeGreaterThan(0);
  });

  it("throws DartError for unknown KRX code (corp_code not in bootstrap)", async () => {
    await expect(fetchDartFinancials("999999", "test-key")).rejects.toThrow(
      DartError,
    );
    await expect(fetchDartFinancials("999999", "test-key")).rejects.toThrow(
      /not_listed_in_dart/,
    );
  });

  it("throws DartError on rate_limit (status=020)", async () => {
    mockByEndpoint([
      {
        fnlttSinglAcnt: { status: "020", message: "요청 제한 초과" },
        alotMatter: NO_DATA,
        stockTotqySttus: NO_DATA,
      },
    ]);
    await expect(fetchDartFinancials("005930", "test-key")).rejects.toThrow(
      /rate_limited/,
    );
  });

  it("opens circuit breaker after 5 consecutive failures", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response("{}", { status: 500 });
    });
    for (let i = 0; i < 5; i++) {
      await expect(fetchDartFinancials("005930", "test-key")).rejects.toThrow();
    }
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const callsBefore = fetchMock.mock.calls.length;
    await expect(fetchDartFinancials("005930", "test-key")).rejects.toThrow(
      /circuit_breaker_open/,
    );
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });
});
