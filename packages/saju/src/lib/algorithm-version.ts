/**
 * 사주 알고리즘 전체 버전.
 *
 * - v1: v0.2 종료 시점 (단순 개수 룰 + 종격 무, 격국-용신 미연동)
 * - v2: v0.3 도입 (자평 룰 통합 + 종격 + 격국-용신 연동, ko/cn-ziping)
 *
 * bump 트리거: shen-strength / jonggyeok / gyeokguk-yongshin 모듈 변경 시.
 * 캐시 키 (saju_charts, yearly_tri, lifetime_narrative, yearly_narrative) 에 모두 포함되어 자동 무효화.
 */
export const ALGORITHM_VERSION = 2;
