// DART OpenDart 단일회사 주요계정 API 응답 타입.
// 출처: https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS003&apiId=AC00073

import { z } from "zod";

// 응답 상태 코드 (메시지 설명)
export const DART_STATUS = {
  OK: "000",
  NO_DATA: "013",
  RATE_LIMIT: "020",
  KEY_SUSPENDED: "010",
} as const;

// 단일 계정 항목
export const DartAccountItemSchema = z.object({
  rcept_no: z.string(),         // 접수번호 (14자리)
  reprt_code: z.string(),       // 보고서 코드 (11011/11012/11013/11014)
  bsns_year: z.string(),        // 사업연도 (4자리)
  corp_code: z.string(),        // 회사 고유번호 (8자리)
  stock_code: z.string().optional(),
  fs_div: z.enum(["CFS", "OFS"]).optional(), // 연결/별도
  fs_nm: z.string().optional(),
  sj_div: z.string().optional(),             // BS/IS/CIS/CF/SCE
  sj_nm: z.string().optional(),
  account_nm: z.string(),                    // 계정명 (매출액/영업이익/...)
  thstrm_nm: z.string().optional(),          // 당기명 (e.g. "제 57 기 3분기")
  thstrm_amount: z.string().optional(),      // 당기 금액 (쉼표 포함 문자열)
  thstrm_add_amount: z.string().optional(),  // 당기 누적 금액 (3분기까지 합)
  frmtrm_nm: z.string().optional(),          // 전기명
  frmtrm_amount: z.string().optional(),
  bfefrmtrm_amount: z.string().optional(),   // 전전기
  currency: z.string().optional(),
});
export type DartAccountItem = z.infer<typeof DartAccountItemSchema>;

export const DartResponseSchema = z.object({
  status: z.string(),
  message: z.string(),
  list: z.array(DartAccountItemSchema).optional(),
});
export type DartResponse = z.infer<typeof DartResponseSchema>;

// 보고서 코드 (분기 → reprt_code 변환)
export const REPORT_CODES = {
  Q1: "11013",
  HALF: "11012",       // 반기 (Q2 누적)
  Q3: "11014",
  ANNUAL: "11011",     // 사업보고서 (Q4 누적)
} as const;
export type ReportCode = (typeof REPORT_CODES)[keyof typeof REPORT_CODES];

// 정규화된 결과 (orchestrator 에 노출)
export interface DartFinancials {
  krxCode: string;
  corpCode: string;
  reportPeriod: string;           // "2025-Q3" 또는 "2024-사업보고서"
  revenueTrailing4Q: number | null;
  revenueGrowthYoY: number | null;   // %
  operatingProfitTrailing4Q: number | null;
  opMarginPct: number | null;         // %
  eps: number | null;                 // trailing EPS (원)
  bps: number | null;                 // 분기말 BPS (원)
  annualDPS: number | null;           // 연간 주당배당금 (원), 사업보고서에만 존재
  asOf: string;                       // YYYY-MM-DD (가장 최근 공시 접수일자 추정)
}

export class DartError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "DartError";
  }
}
