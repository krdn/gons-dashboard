// 데이터스토어 심층지표 임계값 (이슈 #323 §J, Phase 4).
//
// 값의 근거를 주석으로 남긴다 — 근거 없는 임계는 나중에 오탐이 나도
// 올려야 할지 내려야 할지 판단할 수 없다.

/** PG 연결 고갈 임박 — 앱 장애 직결이라 critical. */
export const PG_CONN_CRITICAL_RATIO = 0.9;

/** PG 연결 사용률 경고. */
export const PG_CONN_WARN_RATIO = 0.75;

/**
 * Redis 메모리 — **상한이 설정돼 있으면 비율로 판정한다.**
 *
 * ⚠️ 2026-07-20 재실측으로 초기 설계를 정정했다. "maxmemory 는 0(무제한)이라
 * 분모가 없다"고 단정했으나 실제로는 인스턴스마다 다르다:
 *   ais-prod-redis  maxmemory=1GiB  noeviction    used=799MiB (78%)
 *   n8n-redis       maxmemory=1GiB  allkeys-lru   used=1MiB   (0.1%)
 *   나머지 3개      maxmemory=0(무제한)
 *
 * 절대 크기만 보면 위 두 인스턴스의 **위험도 차이를 표현할 수 없다**.
 * noeviction 은 상한 도달 시 축출이 아니라 **쓰기가 실패**하므로 장애 직결이고,
 * allkeys-lru 는 오래된 키를 버리며 정상 동작한다.
 */
export const REDIS_MEM_CRITICAL_RATIO = 0.9;
export const REDIS_MEM_WARN_RATIO = 0.75;

/**
 * 상한이 없는(maxmemory=0) 인스턴스용 절대 경고 임계.
 * 비율을 계산할 분모가 없을 때만 쓴다 — 무제한이라도 호스트 메모리를 잠식하면
 * 알아야 하기 때문. 정상군(1~2MiB)과 3자릿수 떨어져 있어 오탐 여지가 없다.
 */
export const REDIS_MEM_WARN_BYTES = 512 * 1024 * 1024;

/** 상한 도달 시 축출하지 않고 쓰기가 실패하는 정책 — 같은 사용률이라도 더 위험. */
export const REDIS_NO_EVICTION_POLICY = "noeviction";
