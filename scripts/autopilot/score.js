// scripts/autopilot/score.js
// judge 패널의 평결을 평균내어 후보 점수 산출. 보호경로/마이그레이션 페널티 적용.

const PROTECTED_PENALTY = 2.0;
const DB_MIGRATION_PENALTY = 1.5;

/**
 * @param {{ protectedPathTouch: boolean, dbMigration: boolean }} candidate
 * @param {{ valueScore: number, safetyScore: number, feasibilityScore: number }[]} verdicts
 * @returns {number}
 */
export function computeScore(candidate, verdicts) {
  if (!verdicts || verdicts.length === 0) return 0;
  const n = verdicts.length;
  const avgValue = verdicts.reduce((s, v) => s + v.valueScore, 0) / n;
  const avgSafety = verdicts.reduce((s, v) => s + v.safetyScore, 0) / n;
  const avgFeasibility = verdicts.reduce((s, v) => s + v.feasibilityScore, 0) / n;

  let score = avgValue * 0.4 + avgSafety * 0.35 + avgFeasibility * 0.25;
  if (candidate.protectedPathTouch) score -= PROTECTED_PENALTY;
  if (candidate.dbMigration) score -= DB_MIGRATION_PENALTY;
  return score;
}

/**
 * backlog 중복 판별: dedupKey 가 이미 backlog 에 있으면 true.
 * @param {string} dedupKey
 * @param {{ dedupKey: string }[]} backlog
 * @returns {boolean}
 */
export function isDuplicate(dedupKey, backlog) {
  return backlog.some((b) => b.dedupKey === dedupKey);
}
