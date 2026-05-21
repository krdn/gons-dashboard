import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchAllKrxItems } from "./fetch-data-go-kr";

function mockResponse(
  body: unknown,
  opts: { ok?: boolean; status?: number } = {},
) {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: "OK",
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function makeItem(
  srtnCd: string,
  mrktCtg: "KOSPI" | "KOSDAQ",
  itmsNm: string,
) {
  return {
    srtnCd,
    isinCd: `KR7${srtnCd}000`,
    itmsNm,
    mrktCtg,
    basDt: "20260521",
  };
}

function makePage(
  items: ReturnType<typeof makeItem>[],
  pageNo: number,
  totalCount: number,
) {
  return {
    response: {
      header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
      body: { numOfRows: items.length, pageNo, totalCount, items: { item: items } },
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("fetchAllKrxItems", () => {
  it("페이지네이션: 2페이지에 걸쳐 전체 fetch", async () => {
    const page1 = makePage(
      Array.from({ length: 1000 }, (_, i) =>
        makeItem(String(i).padStart(6, "0"), "KOSPI", `종목${i}`),
      ),
      1,
      1500,
    );
    const page2 = makePage(
      Array.from({ length: 500 }, (_, i) =>
        makeItem(String(1000 + i).padStart(6, "0"), "KOSDAQ", `종목${1000 + i}`),
      ),
      2,
      1500,
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(page1))
      .mockResolvedValueOnce(mockResponse(page2));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchAllKrxItems("test-key");
    expect(result.items).toHaveLength(1500);
    expect(result.errors).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("HTTP 401 → errors 배열에 기록 + 빈 items 반환", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        mockResponse({}, { ok: false, status: 401 }),
      ) as unknown as typeof fetch;
    const result = await fetchAllKrxItems("bad-key");
    expect(result.items).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/401/);
  });

  it("resultCode != 00 → errors 기록", async () => {
    const errBody = {
      response: {
        header: {
          resultCode: "30",
          resultMsg: "SERVICE KEY IS NOT REGISTERED ERROR.",
        },
        body: { numOfRows: 0, pageNo: 1, totalCount: 0, items: { item: [] } },
      },
    };
    global.fetch = vi
      .fn()
      .mockResolvedValue(mockResponse(errBody)) as unknown as typeof fetch;
    const result = await fetchAllKrxItems("test-key");
    expect(result.items).toEqual([]);
    expect(result.errors[0]).toMatch(/SERVICE KEY/);
  });
});
