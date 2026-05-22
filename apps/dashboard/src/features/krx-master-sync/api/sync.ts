import "server-only";
import { env } from "@/shared/config/env";
import { fetchAllKrxItems } from "./fetch-krx-openapi";
import { reconcileStockMaster, type ReconcileInput } from "./reconcile";
import { toYahooSymbol, inferSecurityType } from "../lib/symbol-mapping";

export interface SyncResult {
  fetched: number;
  upserted: number;
  delisted: number;
  migrations: number;
  durationMs: number;
  errors: string[];
}

// KRX OpenAPI basDd 는 영업일 YYYYMMDD. 가장 최근 영업일을 호출자가 선택.
// 일요일 06:00 KST cron 기준 → 직전 금요일이 가장 안전.
// 단순화: cron 발사 시점 KST 날짜에서 (요일에 따라) 1-3일 뒤로 backdate.
function recentBusinessDay(now: Date = new Date()): string {
  // KST 기준 날짜.
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  let backDays = 1; // 기본: 어제
  if (day === 0) backDays = 2; // 일요일 → 금요일
  else if (day === 1) backDays = 3; // 월요일 → 금요일
  else if (day === 6) backDays = 1; // 토요일 → 금요일
  const target = new Date(kst.getTime() - backDays * 24 * 60 * 60 * 1000);
  const yyyy = target.getUTCFullYear();
  const mm = String(target.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(target.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

export async function syncKrxMaster(): Promise<SyncResult> {
  const startedAt = Date.now();
  const errors: string[] = [];

  const basDd = recentBusinessDay();
  const fetchResult = await fetchAllKrxItems(env.KRX_OPENAPI_AUTH_KEY, basDd);
  errors.push(...fetchResult.errors);

  if (fetchResult.items.length === 0) {
    return {
      fetched: 0,
      upserted: 0,
      delisted: 0,
      migrations: 0,
      durationMs: Date.now() - startedAt,
      errors,
    };
  }

  // KRX item → reconcile input 변환 + 중복 제거 (이론상 KRX 는 시장별 endpoint 라 중복 없음, 안전장치).
  const seen = new Set<string>();
  const rows: ReconcileInput[] = [];
  for (const { item, market } of fetchResult.items) {
    if (seen.has(item.ISU_SRT_CD)) continue;
    seen.add(item.ISU_SRT_CD);
    rows.push({
      symbol: toYahooSymbol(item.ISU_SRT_CD, market),
      krxCode: item.ISU_SRT_CD,
      koreanName: item.ISU_NM,
      englishName: item.ISU_ENG_NM ?? null,
      marketCategory: market,
      securityType: inferSecurityType(item.ISU_NM),
    });
  }

  const reconcileResult = await reconcileStockMaster(rows);
  errors.push(...reconcileResult.errors);

  return {
    fetched: fetchResult.items.length,
    upserted: reconcileResult.upserted,
    delisted: reconcileResult.delisted,
    migrations: reconcileResult.migrations,
    durationMs: Date.now() - startedAt,
    errors,
  };
}
