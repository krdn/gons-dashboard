import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchAllKrxItems } from "./fetch-krx-openapi";

function mockResponse(
  body: unknown,
  opts: { ok?: boolean; status?: number; statusText?: string } = {},
) {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: opts.statusText ?? "OK",
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(
      typeof body === "string" ? body : JSON.stringify(body),
    ),
  } as unknown as Response;
}

function makeItem(srtnCd: string, nm: string) {
  return {
    ISU_SRT_CD: srtnCd,
    ISU_CD: `KR7${srtnCd}000`,
    ISU_NM: nm,
  };
}

afterEach(() => vi.clearAllMocks());

describe("fetchAllKrxItems", () => {
  it("KOSPI + KOSDAQ 두 endpoint 호출 → items 합산 + market 태그", async () => {
    const fetchMock = vi
      .fn()
      // 1st: KOSPI
      .mockResolvedValueOnce(
        mockResponse({
          OutBlock_1: [makeItem("005930", "삼성전자"), makeItem("000660", "SK하이닉스")],
        }),
      )
      // 2nd: KOSDAQ
      .mockResolvedValueOnce(
        mockResponse({
          OutBlock_1: [makeItem("036930", "주성엔지니어링")],
        }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchAllKrxItems("test-auth-key", "20260520");
    expect(result.items).toHaveLength(3);
    expect(result.errors).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const samsung = result.items.find((x) => x.item.ISU_SRT_CD === "005930");
    expect(samsung?.market).toBe("KOSPI");

    const jusung = result.items.find((x) => x.item.ISU_SRT_CD === "036930");
    expect(jusung?.market).toBe("KOSDAQ");
  });

  it("URL 에 basDd + AUTH_KEY query parameter 포함", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockResponse({ OutBlock_1: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchAllKrxItems("my-key", "20260520");
    const firstCallUrl = fetchMock.mock.calls[0][0] as string;
    expect(firstCallUrl).toContain("basDd=20260520");
    expect(firstCallUrl).toContain("AUTH_KEY=my-key");
    expect(firstCallUrl).toContain("/sto/stk_isu_base_info");
  });

  it("HTTP 401 → errors 배열 기록 + items 비어있음 (시장 한 곳 실패해도 다른 시장 진행)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(
        '{"respMsg":"Unauthorized API Call","respCode":"401"}',
        { ok: false, status: 401, statusText: "Unauthorized" },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchAllKrxItems("bad-key", "20260520");
    expect(result.items).toEqual([]);
    expect(result.errors).toHaveLength(2); // KOSPI + KOSDAQ 둘 다 fail
    expect(result.errors[0]).toMatch(/401/);
    expect(result.errors[0]).toMatch(/KOSPI/);
    expect(result.errors[1]).toMatch(/KOSDAQ/);
  });

  it("schema mismatch → errors 기록 + 해당 시장 skip", async () => {
    const fetchMock = vi
      .fn()
      // 1st: KOSPI → 잘못된 형식 (OutBlock_1 누락)
      .mockResolvedValueOnce(mockResponse({ wrongKey: [] }))
      // 2nd: KOSDAQ → 정상
      .mockResolvedValueOnce(
        mockResponse({ OutBlock_1: [makeItem("036930", "주성엔지니어링")] }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchAllKrxItems("key", "20260520");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/KOSPI/);
    expect(result.errors[0]).toMatch(/schema mismatch/);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].market).toBe("KOSDAQ");
  });
});
