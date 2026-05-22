import { describe, it, expect } from "vitest";
import { KrxStockItemSchema, KrxStockResponseSchema } from "./schema";

describe("KrxStockItemSchema", () => {
  it("정상 item parse (필수 필드만)", () => {
    const r = KrxStockItemSchema.parse({
      ISU_SRT_CD: "005930",
      ISU_CD: "KR7005930003",
      ISU_NM: "삼성전자",
    });
    expect(r.ISU_SRT_CD).toBe("005930");
    expect(r.ISU_NM).toBe("삼성전자");
  });

  it("optional 필드 포함 parse", () => {
    const r = KrxStockItemSchema.parse({
      ISU_SRT_CD: "036930",
      ISU_CD: "KR7036930007",
      ISU_NM: "주성엔지니어링",
      MKT_TP_NM: "KOSDAQ",
      LIST_DD: "20010411",
      LIST_SHRS: "76023400",
    });
    expect(r.MKT_TP_NM).toBe("KOSDAQ");
    expect(r.LIST_SHRS).toBe("76023400");
  });

  it("필수 필드 누락 시 throw", () => {
    expect(() =>
      KrxStockItemSchema.parse({ ISU_SRT_CD: "005930" }),
    ).toThrow();
  });

  it("ISU_SRT_CD 6자리가 아니면 throw", () => {
    expect(() =>
      KrxStockItemSchema.parse({
        ISU_SRT_CD: "12345",
        ISU_CD: "KR7000000000",
        ISU_NM: "테스트",
      }),
    ).toThrow();
  });

  it("우선주 alphanumeric 코드도 통과 (00104K, 37550K 등)", () => {
    const cj = KrxStockItemSchema.parse({
      ISU_SRT_CD: "00104K",
      ISU_CD: "KR700104K010",
      ISU_NM: "CJ4우선주(전환)",
    });
    expect(cj.ISU_SRT_CD).toBe("00104K");

    const dl = KrxStockItemSchema.parse({
      ISU_SRT_CD: "37550K",
      ISU_CD: "KR737550K011",
      ISU_NM: "DL이앤씨1우선주",
    });
    expect(dl.ISU_SRT_CD).toBe("37550K");
  });

  it("소문자 알파벳은 reject (KRX 단축코드는 모두 대문자)", () => {
    expect(() =>
      KrxStockItemSchema.parse({
        ISU_SRT_CD: "00104k",
        ISU_CD: "KR700104K010",
        ISU_NM: "테스트",
      }),
    ).toThrow();
  });

  it("알 수 없는 필드는 passthrough (스키마 변경에 견고)", () => {
    const r = KrxStockItemSchema.parse({
      ISU_SRT_CD: "005930",
      ISU_CD: "KR7005930003",
      ISU_NM: "삼성전자",
      UNKNOWN_FIELD: "future",
    });
    expect(r.ISU_NM).toBe("삼성전자");
  });
});

describe("KrxStockResponseSchema", () => {
  it("정상 응답 parse + OutBlock_1 배열 추출", () => {
    const r = KrxStockResponseSchema.parse({
      OutBlock_1: [
        {
          ISU_SRT_CD: "005930",
          ISU_CD: "KR7005930003",
          ISU_NM: "삼성전자",
        },
        {
          ISU_SRT_CD: "036930",
          ISU_CD: "KR7036930007",
          ISU_NM: "주성엔지니어링",
        },
      ],
    });
    expect(r.OutBlock_1).toHaveLength(2);
    expect(r.OutBlock_1[1].ISU_NM).toBe("주성엔지니어링");
  });

  it("빈 OutBlock_1 도 parse 통과", () => {
    const r = KrxStockResponseSchema.parse({ OutBlock_1: [] });
    expect(r.OutBlock_1).toEqual([]);
  });
});
