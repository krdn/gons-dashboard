import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("./fetch-data-go-kr", () => ({
  fetchAllKrxItems: vi.fn(),
}));
vi.mock("./reconcile", () => ({
  reconcileStockMaster: vi.fn(),
}));
vi.mock("@/shared/config/env", () => ({
  env: { KRX_DATA_GO_KR_API_KEY: "test-key" },
}));

import { fetchAllKrxItems } from "./fetch-data-go-kr";
import { reconcileStockMaster } from "./reconcile";
import { syncKrxMaster } from "./sync";

afterEach(() => vi.clearAllMocks());

describe("syncKrxMaster", () => {
  it("정상 흐름: fetch → reconcile → 결과 집계", async () => {
    vi.mocked(fetchAllKrxItems).mockResolvedValue({
      items: [
        {
          srtnCd: "036930",
          isinCd: "KR7036930007",
          itmsNm: "주성엔지니어링",
          mrktCtg: "KOSDAQ",
          basDt: "20260521",
        },
      ],
      errors: [],
    });
    vi.mocked(reconcileStockMaster).mockResolvedValue({
      upserted: 1,
      delisted: 0,
      migrations: 0,
      errors: [],
    });

    const result = await syncKrxMaster();
    expect(result.fetched).toBe(1);
    expect(result.upserted).toBe(1);
    expect(result.delisted).toBe(0);
    expect(result.migrations).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(reconcileStockMaster).toHaveBeenCalledWith([
      expect.objectContaining({
        symbol: "036930.KQ",
        krxCode: "036930",
        koreanName: "주성엔지니어링",
        marketCategory: "KOSDAQ",
        securityType: "EQUITY",
      }),
    ]);
  });

  it("fetch 가 0건 + 에러 → reconcile 호출 안 함, errors 반환", async () => {
    vi.mocked(fetchAllKrxItems).mockResolvedValue({
      items: [],
      errors: ["page 1: HTTP 401 Unauthorized"],
    });
    const result = await syncKrxMaster();
    expect(result.fetched).toBe(0);
    expect(result.upserted).toBe(0);
    expect(result.errors).toContain("page 1: HTTP 401 Unauthorized");
    expect(reconcileStockMaster).not.toHaveBeenCalled();
  });
});
