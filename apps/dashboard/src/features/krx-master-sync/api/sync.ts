import "server-only";
import { env } from "@/shared/config/env";
import { fetchAllKrxItems } from "./fetch-data-go-kr";
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

export async function syncKrxMaster(): Promise<SyncResult> {
  const startedAt = Date.now();
  const errors: string[] = [];

  const fetchResult = await fetchAllKrxItems(env.KRX_DATA_GO_KR_API_KEY);
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

  // API item → reconcile input 변환 + 중복 제거 (같은 krxCode 가 페이지 경계에서 두 번 올 수 있음)
  const seen = new Set<string>();
  const rows: ReconcileInput[] = [];
  for (const item of fetchResult.items) {
    if (seen.has(item.srtnCd)) continue;
    seen.add(item.srtnCd);
    rows.push({
      symbol: toYahooSymbol(item.srtnCd, item.mrktCtg),
      krxCode: item.srtnCd,
      koreanName: item.itmsNm,
      englishName: null, // API 에 영문명 필드 없음
      marketCategory: item.mrktCtg,
      securityType: inferSecurityType(item.itmsNm),
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
