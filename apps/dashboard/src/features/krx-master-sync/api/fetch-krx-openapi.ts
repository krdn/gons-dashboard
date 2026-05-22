import "server-only";
import { KrxStockResponseSchema, type KrxStockItem } from "../model/schema";

// KRX OpenAPI base URL (운영 검증된 도메인).
const BASE_URL = "https://data-dbg.krx.co.kr/svc/apis";
const TIMEOUT_MS = 15_000;

// 시장별 endpoint — KRX OpenAPI 는 종목기본정보를 KOSPI/KOSDAQ 별로 분리 제공.
// KONEX (knx_isu_base_info) 는 v1.0 out of scope.
const ENDPOINTS = {
  KOSPI: "/sto/stk_isu_base_info",
  KOSDAQ: "/sto/ksq_isu_base_info",
} as const;

export type KrxMarket = keyof typeof ENDPOINTS;

export interface FetchResult {
  // (item, market) 쌍 — sync 단계에서 시장구분 → Yahoo 심볼 매핑에 사용.
  items: Array<{ item: KrxStockItem; market: KrxMarket }>;
  errors: string[];
}

// basDd 는 영업일 YYYYMMDD. KRX 휴장일이면 빈 응답 가능 — 호출자는 가장 최근 영업일 사용 권장.
// 종목기본정보는 페이지네이션 없음 (전체 종목을 단일 응답으로 반환).
export async function fetchAllKrxItems(
  authKey: string,
  basDd: string,
): Promise<FetchResult> {
  const items: Array<{ item: KrxStockItem; market: KrxMarket }> = [];
  const errors: string[] = [];

  for (const market of Object.keys(ENDPOINTS) as KrxMarket[]) {
    const endpoint = ENDPOINTS[market];
    const url =
      `${BASE_URL}${endpoint}` +
      `?basDd=${encodeURIComponent(basDd)}` +
      `&AUTH_KEY=${encodeURIComponent(authKey)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timer);
      if (!res.ok) {
        // 401: 인증키 invalid 또는 해당 API 미신청 (개별 API 별 구독 필요).
        // 다른 시장도 같은 권한 영향 받을 수 있으나 일단 기록 후 계속.
        const body = await res.text();
        errors.push(
          `${market}: HTTP ${res.status} ${res.statusText}: ${body.slice(0, 200)}`,
        );
        continue;
      }
      const json = await res.json();
      const parsed = KrxStockResponseSchema.safeParse(json);
      if (!parsed.success) {
        errors.push(
          `${market}: schema mismatch: ${parsed.error.message.slice(0, 300)}`,
        );
        continue;
      }
      for (const item of parsed.data.OutBlock_1) {
        items.push({ item, market });
      }
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${market}: ${msg}`);
    }
  }

  return { items, errors };
}
