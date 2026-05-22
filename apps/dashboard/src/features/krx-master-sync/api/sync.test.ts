import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("./fetch-krx-openapi", () => ({
  fetchAllKrxItems: vi.fn(),
}));
vi.mock("./reconcile", () => ({
  reconcileStockMaster: vi.fn(),
}));
vi.mock("@/shared/config/env", () => ({
  env: { KRX_OPENAPI_AUTH_KEY: "test-key" },
}));

import { fetchAllKrxItems } from "./fetch-krx-openapi";
import { reconcileStockMaster } from "./reconcile";
import { syncKrxMaster } from "./sync";

afterEach(() => vi.clearAllMocks());

describe("syncKrxMaster", () => {
  it("정상 흐름: fetch → reconcile → 결과 집계", async () => {
    vi.mocked(fetchAllKrxItems).mockResolvedValue({
      items: [
        {
          item: {
            ISU_SRT_CD: "036930",
            ISU_CD: "KR7036930007",
            ISU_NM: "주성엔지니어링",
            ISU_ENG_NM: "Jusung Engineering Co Ltd",
          },
          market: "KOSDAQ",
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
        englishName: "Jusung Engineering Co Ltd",
        marketCategory: "KOSDAQ",
        securityType: "EQUITY",
      }),
    ]);
  });

  it("ISU_ENG_NM 누락 시 englishName=null", async () => {
    vi.mocked(fetchAllKrxItems).mockResolvedValue({
      items: [
        {
          item: {
            ISU_SRT_CD: "005930",
            ISU_CD: "KR7005930003",
            ISU_NM: "삼성전자",
          },
          market: "KOSPI",
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

    await syncKrxMaster();
    expect(reconcileStockMaster).toHaveBeenCalledWith([
      expect.objectContaining({
        symbol: "005930.KS",
        englishName: null,
        marketCategory: "KOSPI",
      }),
    ]);
  });

  it("fetch 가 0건 + 에러 → reconcile 호출 안 함, errors 반환", async () => {
    vi.mocked(fetchAllKrxItems).mockResolvedValue({
      items: [],
      errors: ["KOSPI: HTTP 401 Unauthorized"],
    });
    const result = await syncKrxMaster();
    expect(result.fetched).toBe(0);
    expect(result.upserted).toBe(0);
    expect(result.errors).toContain("KOSPI: HTTP 401 Unauthorized");
    expect(reconcileStockMaster).not.toHaveBeenCalled();
  });
});
