import "server-only";
import {
  DataGoKrResponseSchema,
  type DataGoKrItem,
} from "../model/schema";

const ENDPOINT =
  "https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo";
const NUM_OF_ROWS = 1000;
const PER_PAGE_TIMEOUT_MS = 10_000;
const MAX_PAGES = 20; // safety cap — 정상 사용량 ~4 페이지

export interface FetchResult {
  items: DataGoKrItem[];
  errors: string[];
}

// 페이지네이션으로 전체 KRX 종목 fetch.
// API 가 "오늘 일자 시세" 를 함께 반환하므로 basDt 미지정 (서버 기본 = 영업일).
export async function fetchAllKrxItems(apiKey: string): Promise<FetchResult> {
  const items: DataGoKrItem[] = [];
  const errors: string[] = [];

  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
    const url =
      `${ENDPOINT}?serviceKey=${encodeURIComponent(apiKey)}` +
      `&numOfRows=${NUM_OF_ROWS}&pageNo=${pageNo}&resultType=json`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PER_PAGE_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        errors.push(`page ${pageNo}: HTTP ${res.status} ${res.statusText}`);
        return { items, errors }; // 인증 실패는 다음 페이지도 같음 → abort
      }
      const json = await res.json();
      const parsed = DataGoKrResponseSchema.safeParse(json);
      if (!parsed.success) {
        errors.push(
          `page ${pageNo}: schema mismatch: ${parsed.error.message}`,
        );
        return { items, errors };
      }
      if (parsed.data.response.header.resultCode !== "00") {
        errors.push(
          `page ${pageNo}: API error ${parsed.data.response.header.resultCode} ${parsed.data.response.header.resultMsg}`,
        );
        return { items, errors };
      }
      const pageItems = parsed.data.response.body.items.item;
      items.push(...pageItems);
      const total = parsed.data.response.body.totalCount;
      if (items.length >= total || pageItems.length < NUM_OF_ROWS) {
        break; // 전체 수집 완료
      }
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`page ${pageNo}: ${msg}`);
      return { items, errors };
    }
  }

  return { items, errors };
}
