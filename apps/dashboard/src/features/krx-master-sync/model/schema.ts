import { z } from "zod";

// data.go.kr "금융위원회 주식시세정보" - getStockPriceInfo 응답 schema.
// 필드명은 공식 명세를 따른다 (srtnCd=종목코드, itmsNm=종목명, mrktCtg=시장구분).
// 응답은 일별 시세도 포함하나 우리는 마스터 정보만 필요.
export const DataGoKrItemSchema = z.object({
  srtnCd: z.string().regex(/^\d{6}$/, "6자리 종목코드"),
  isinCd: z.string().min(1),
  itmsNm: z.string().min(1), // 한글 종목명
  mrktCtg: z.enum(["KOSPI", "KOSDAQ"]), // KONEX 등은 v1.0 out of scope → throw
  basDt: z.string().regex(/^\d{8}$/, "YYYYMMDD"),
  // 일별 시세 필드들은 마스터 sync 에서 사용 안 함 — optional 로 허용
  clpr: z.string().optional(),
  vs: z.string().optional(),
  fltRt: z.string().optional(),
  mkp: z.string().optional(),
  hipr: z.string().optional(),
  lopr: z.string().optional(),
  trqu: z.string().optional(),
  trPrc: z.string().optional(),
  lstgStCnt: z.string().optional(),
  mrktTotAmt: z.string().optional(),
});

export type DataGoKrItem = z.infer<typeof DataGoKrItemSchema>;

export const DataGoKrResponseSchema = z.object({
  response: z.object({
    header: z.object({
      resultCode: z.string(),
      resultMsg: z.string(),
    }),
    body: z.object({
      numOfRows: z.number(),
      pageNo: z.number(),
      totalCount: z.number(),
      items: z.object({
        item: z.array(DataGoKrItemSchema),
      }),
    }),
  }),
});

export type DataGoKrResponse = z.infer<typeof DataGoKrResponseSchema>;
