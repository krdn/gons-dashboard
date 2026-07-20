// DB/Redis liveness 점검 대상 — 이슈 #323 §G (Phase 3).
// monitoring-availability/config/sites.ts 의 미러 구조.
//
// ⚠️ 이 파일이 **판정의 단일 소스**다. 에이전트에도 같은 목록을 env
// (`DATASTORE_SPECS`) 로 넘기지만, 판정은 항상 여기를 기준으로 순회한다 —
// env 가 낡아 목록이 갈리면 보드에 unknown(관측 공백)으로 드러나야지
// 조용히 점검 대상에서 빠지면 안 된다. 갱신 시 README 의 env 예시도 함께.
//
// 실측 2026-07-20: 노출 10개(PG 6 + Redis 4) 리스닝 확인, 미노출 2건은 포트 없음.
// container 는 12개 전부 실재 확인 — Phase 4 §J 심층지표는 미노출 2건도 관측한다.

export interface DatastoreInstance {
  kind: "pg" | "redis";
  /**
   * check_results.target = 이벤트 dedup 대상 식별자.
   *
   * ⚠️ target 만으로는 식별되지 않는다 — gons-dashboard·ais-prod·voice 는
   * PG 와 Redis 양쪽에 같은 이름으로 존재한다. 식별자는 항상 (kind, target)
   * 복합이다 (check_results 인덱스가 복합인 이유와 동일).
   */
  target: string;
  /** 미노출(호스트에서 도달 불가)이면 undefined — liveness 는 항상 unknown 판정. */
  port?: number;
  /**
   * 도커 컨테이너 이름 — Phase 4 §J 심층지표(연결 수·크기)의 수집 대상.
   *
   * ⚠️ 이 채널은 **네트워크 노출과 무관**하다. 컨테이너 안 로컬 소켓 trust 인증을
   * 쓰므로 port 가 없는 인스턴스(sms-insights·n8n)도 동일하게 관측된다 — Phase 3
   * 에서 영구 unknown 이던 2건이 심층지표에서는 정상 판정을 받는다.
   */
  container: string;
}

export const DATASTORE_INSTANCES: DatastoreInstance[] = [
  { kind: "pg", target: "gons-dashboard", port: 5440, container: "gons-dashboard-postgres" },
  { kind: "pg", target: "ais-prod", port: 5438, container: "ais-prod-postgres" },
  { kind: "pg", target: "krdn-timescaledb", port: 5435, container: "krdn-timescaledb" },
  { kind: "pg", target: "voice", port: 5437, container: "voice-postgres" },
  { kind: "pg", target: "n8n", port: 5434, container: "n8n-postgres" },
  { kind: "pg", target: "ais", port: 5436, container: "ais-postgres" },
  // 포트 미노출 — 컨테이너 healthcheck 승격은 Phase 4.
  { kind: "pg", target: "sms-insights", container: "sms-insights-postgres" },
  { kind: "redis", target: "gons-dashboard", port: 6390, container: "gons-dashboard-redis" },
  { kind: "redis", target: "ais-prod", port: 6385, container: "ais-prod-redis" },
  { kind: "redis", target: "news-prod", port: 6380, container: "news-prod-redis" },
  { kind: "redis", target: "voice", port: 6382, container: "voice-redis" },
  { kind: "redis", target: "n8n", container: "n8n-redis" },
];
