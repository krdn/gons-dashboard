// daily OHLC Redis 캐시 래퍼 — 일봉은 하루 1회만 의미 있게 바뀌므로 6h TTL 로 캐싱해
// 매 RSC 렌더마다의 Yahoo 호출을 줄인다. retry 는 packages 어댑터 내부에 있다.
//
// 정책:
//  - hit → JSON 파싱 반환 (fetch skip)
//  - miss → fetchYahooDailyOHLC (retry 내장) → 비어있지 않으면 6h TTL 로 SET
//  - 빈 배열(실패)은 캐싱 안 함 — 빈 차트가 6h 고착되는 것 방지
//  - Redis 다운(get/set throw) 은 fail-open / best-effort — 데이터 흐름을 막지 않음
import "server-only";
import { fetchYahooDailyOHLC } from "@gons/stock-analysis";
import { getRedisClient } from "@/shared/lib/redis/client";

type DailyOHLC = Array<{ date: string; close: number; volume: number }>;
type Range = "1mo" | "3mo" | "6mo" | "1y" | "5y";

const TTL_SECONDS = 6 * 60 * 60; // 6h

export async function getCachedDailyOHLC(
  symbol: string,
  range: Range = "1y",
): Promise<DailyOHLC> {
  const key = `stock:ohlc:${symbol}:${range}`;
  const redis = getRedisClient();

  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as DailyOHLC;
  } catch {
    // Redis down → 직접 fetch 로 폴백 (fail-open)
  }

  const data = await fetchYahooDailyOHLC(symbol, range);

  if (data.length > 0) {
    try {
      await redis.set(key, JSON.stringify(data), "EX", TTL_SECONDS);
    } catch {
      // 캐시 write 실패는 best-effort — 데이터는 이미 있으니 무시
    }
  }
  return data;
}
