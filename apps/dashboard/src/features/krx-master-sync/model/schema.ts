import { z } from "zod";

// KRX OpenAPI "유가증권/코스닥 종목기본정보" 응답 schema.
// 엔드포인트: GET data-dbg.krx.co.kr/svc/apis/sto/{stk|ksq}_isu_base_info?basDd=YYYYMMDD&AUTH_KEY=...
// 응답 root: { OutBlock_1: [...] }
//
// 필드명은 KRX 공식 명세 (대문자 SNAKE_CASE). 공개 sample 기준:
//   ISU_SRT_CD : 단축코드 (6자리, 예: "005930")
//   ISU_CD     : ISIN 코드 (12자리, 예: "KR7005930003")
//   ISU_NM     : 한글 종목명 (예: "삼성전자")
//   ISU_ABBRV  : 약식 종목명 (선택, 공백 제거된 형태)
//   ISU_ENG_NM : 영문 종목명 (선택)
//   LIST_DD    : 상장일 YYYYMMDD (선택)
//   MKT_TP_NM  : 시장구분 (선택, 응답에 따라 누락 가능 — 우리는 endpoint URL 로 시장 구분)
//   SECUGRP_NM : 증권그룹구분 (선택, 예: "주권", "외국주권")
//   SECT_TP_NM : 소속부 (선택)
//   KIND_STKCERT_TP_NM : 주식종류 (선택)
//   PARVAL     : 액면가 (선택)
//   LIST_SHRS  : 상장주식수 (선택)
//
// 사용자의 KRX OpenAPI 구독 승인 후 첫 호출에서 실제 필드 검증 — 다르면 follow-up PR.
export const KrxStockItemSchema = z
  .object({
    // 단축코드 6자리 — 대부분 숫자지만 우선주(전환/신형)는 끝자리에 알파벳 포함
    // 예: "095570" (보통주), "00104K" (CJ4우선주전환), "37550K" (DL이앤씨1우선주)
    ISU_SRT_CD: z.string().regex(/^[0-9A-Z]{6}$/, "6자리 영숫자 단축코드"),
    ISU_CD: z.string().min(1),
    ISU_NM: z.string().min(1), // 한글 종목명
    ISU_ABBRV: z.string().optional(),
    ISU_ENG_NM: z.string().optional(),
    LIST_DD: z.string().optional(),
    MKT_TP_NM: z.string().optional(),
    SECUGRP_NM: z.string().optional(),
    SECT_TP_NM: z.string().optional(),
    KIND_STKCERT_TP_NM: z.string().optional(),
    PARVAL: z.string().optional(),
    LIST_SHRS: z.string().optional(),
  })
  // 알 수 없는 필드는 무시 — 명세에 없는 필드가 추가되어도 깨지지 않도록.
  .passthrough();

export type KrxStockItem = z.infer<typeof KrxStockItemSchema>;

export const KrxStockResponseSchema = z.object({
  OutBlock_1: z.array(KrxStockItemSchema),
});
