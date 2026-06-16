// confusion matrix → precision/recall/f1. 순수 함수 (LLM·DB 의존 없음).
// spec 2026-06-17 §5.

export interface BinaryMetrics {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface BinaryCase {
  predicted: boolean;
  expected: boolean;
}

export function binaryMetrics(cases: BinaryCase[]): BinaryMetrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const c of cases) {
    if (c.predicted && c.expected) tp++;
    else if (c.predicted && !c.expected) fp++;
    else if (!c.predicted && c.expected) fn++;
    else tn++;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, tn, precision, recall, f1 };
}

export interface MultiClassCase<T extends string> {
  predicted: T;
  expected: T;
}

/** macro-averaged F1 — 각 클래스를 one-vs-rest 이진으로 보고 F1 평균. */
export function macroF1<T extends string>(
  cases: MultiClassCase<T>[],
  classes: readonly T[],
): number {
  if (cases.length === 0) return 0;
  const perClassF1 = classes.map((cls) => {
    const binary = cases.map((c) => ({
      predicted: c.predicted === cls,
      expected: c.expected === cls,
    }));
    return binaryMetrics(binary).f1;
  });
  return perClassF1.reduce((a, b) => a + b, 0) / classes.length;
}

/** exact-match accuracy — predicted === expected 비율. */
export function accuracy<T>(cases: { predicted: T; expected: T }[]): number {
  if (cases.length === 0) return 0;
  const correct = cases.filter((c) => c.predicted === c.expected).length;
  return correct / cases.length;
}
