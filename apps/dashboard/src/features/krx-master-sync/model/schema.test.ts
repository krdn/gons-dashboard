import { describe, it, expect } from "vitest";
import { DataGoKrItemSchema, DataGoKrResponseSchema } from "./schema";

describe("DataGoKrItemSchema", () => {
  it("정상 item parse", () => {
    const r = DataGoKrItemSchema.parse({
      srtnCd: "005930",
      isinCd: "KR7005930003",
      itmsNm: "삼성전자",
      mrktCtg: "KOSPI",
      basDt: "20260521",
    });
    expect(r.srtnCd).toBe("005930");
    expect(r.mrktCtg).toBe("KOSPI");
  });

  it("필수 필드 누락 시 throw", () => {
    expect(() => DataGoKrItemSchema.parse({ srtnCd: "005930" })).toThrow();
  });

  it("mrktCtg 가 KOSPI/KOSDAQ 외 값이면 throw", () => {
    expect(() =>
      DataGoKrItemSchema.parse({
        srtnCd: "005930",
        isinCd: "KR7005930003",
        itmsNm: "삼성전자",
        mrktCtg: "KONEX",
        basDt: "20260521",
      }),
    ).toThrow();
  });
});

describe("DataGoKrResponseSchema", () => {
  it("정상 응답 parse + items 추출", () => {
    const r = DataGoKrResponseSchema.parse({
      response: {
        header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
        body: {
          numOfRows: 2,
          pageNo: 1,
          totalCount: 4000,
          items: {
            item: [
              {
                srtnCd: "005930",
                isinCd: "KR7005930003",
                itmsNm: "삼성전자",
                mrktCtg: "KOSPI",
                basDt: "20260521",
              },
              {
                srtnCd: "036930",
                isinCd: "KR7036930007",
                itmsNm: "주성엔지니어링",
                mrktCtg: "KOSDAQ",
                basDt: "20260521",
              },
            ],
          },
        },
      },
    });
    expect(r.response.body.totalCount).toBe(4000);
    expect(r.response.body.items.item).toHaveLength(2);
  });

  it("에러 응답 (resultCode != 00) 도 parse 통과 (호출부에서 분기)", () => {
    const r = DataGoKrResponseSchema.parse({
      response: {
        header: {
          resultCode: "30",
          resultMsg: "SERVICE KEY IS NOT REGISTERED ERROR.",
        },
        body: { numOfRows: 0, pageNo: 1, totalCount: 0, items: { item: [] } },
      },
    });
    expect(r.response.header.resultCode).toBe("30");
  });
});
