// 기술적 지표 (TA) 계산 — 일봉 close 배열에서 MA / RSI 계산.
// PriceChart 오버레이 + Phase 6 snapshot 채움 양쪽 재사용.

export function simpleMovingAverage(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    result.push(sum / period);
  }
  return result;
}

/**
 * Wilder's RSI (period=14 기본). 입력 부족 시 null 배열.
 */
export function relativeStrengthIndex(
  closes: number[],
  period = 14,
): (number | null)[] {
  if (closes.length < period + 1) return closes.map(() => null);
  const result: (number | null)[] = closes.map(() => null);

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

export function lastFinite(arr: (number | null)[]): number | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}
