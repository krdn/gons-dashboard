// 데이터스토어 심층지표 임계값 (이슈 #323 §J, Phase 4).
//
// 값의 근거를 주석으로 남긴다 — 근거 없는 임계는 나중에 오탐이 나도
// 올려야 할지 내려야 할지 판단할 수 없다.

/** PG 연결 고갈 임박 — 앱 장애 직결이라 critical. */
export const PG_CONN_CRITICAL_RATIO = 0.9;

/** PG 연결 사용률 경고. */
export const PG_CONN_WARN_RATIO = 0.75;

/**
 * Redis 메모리 경고 — **절대 임계**다.
 *
 * ⚠️ 비율로 잡을 수 없다: Redis `maxclients` 는 연결 수 상한이지 메모리와 무관하고,
 * `maxmemory` 는 실측상 0(무제한)이라 분모가 없다.
 *
 * ⚠️ 512MiB 인 이유 (2026-07-20 실측):
 *   ais-prod-redis  799.8 MiB   ← 유일한 이상치
 *   나머지 4개      1.1 ~ 2.0 MiB
 * 1GiB 로 잡으면 799.8MiB 가 미달이라 **현재 유일한 이상 인스턴스를 놓친 채**
 * 배포된다(지표가 아무것도 잡지 못함). 512MiB 는 정상군과 3자릿수 떨어져 있어
 * 오탐 여지가 없으면서 실제 이상치를 잡는다.
 */
export const REDIS_MEM_WARN_BYTES = 512 * 1024 * 1024;
