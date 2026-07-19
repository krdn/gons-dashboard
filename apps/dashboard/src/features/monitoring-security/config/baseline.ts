// 보안 관제 기대값 baseline (이슈 #323 §H, Phase 3).
// features/monitoring-availability/config/sites.ts 와 같은 위상 — DB 가 아닌 레포 config.
//
// ⚠️ 최초 배포 시 EXPECTED_IPTABLES / ALLOWED_PORTS 는 운영 서버 실측값으로 채운다:
//   sudo /opt/gons/monitoring-agent/gons-security-collect.sh --stdout
// 값이 placeholder 인 채 배포하면 매 사이클 critical 오탐이 난다.

/**
 * DOCKER-USER 체인 기대값 — 2026-07-12 보안 감사에서 구축한 유일한 인터넷 방어선.
 * 드리프트 시 DB 포트가 인터넷에 노출되므로 불일치는 critical.
 */
export const EXPECTED_IPTABLES = {
  /** `-N`/`-A DOCKER-USER` 줄 수 (체인 선언 포함). 2026-07-20 운영 실측. */
  ruleCount: 6,
  /** 공백 정규화 후 sha256 앞 16자. 2026-07-20 운영 실측. */
  specHash: "329230a7178e0689",
} as const;

/**
 * 의도된 리스닝 소켓 — "protocol:bindAddr:port" 튜플.
 *
 * 포트 번호만 비교하면 127.0.0.1:5434 → 0.0.0.0:5434 처럼 **노출 범위만 넓어진**
 * 변경을 놓친다. bind 주소를 포함한 튜플로 비교해야 그 드리프트가 잡힌다.
 * UDP 는 범위 외 (collector 가 `ss -tlnH` 로 TCP listen 만 수집).
 */
export const ALLOWED_PORTS: readonly string[] = [
  // 2026-07-20 운영 실측 (`gons-security-collect.sh --stdout`).
  // 새 서비스를 의도적으로 노출할 때는 여기에 추가해야 warning 이 해소된다.
  "tcp:*:11434", // ollama
  "tcp:0.0.0.0:80",
  "tcp:0.0.0.0:139", // smbd
  "tcp:0.0.0.0:443",
  "tcp:0.0.0.0:445", // smbd
  "tcp:0.0.0.0:2222",
  "tcp:0.0.0.0:3002",
  "tcp:0.0.0.0:3010",
  "tcp:0.0.0.0:3020", // gons-dashboard
  "tcp:0.0.0.0:3030",
  "tcp:0.0.0.0:3100",
  "tcp:0.0.0.0:3200",
  "tcp:0.0.0.0:3300",
  "tcp:0.0.0.0:3401",
  "tcp:0.0.0.0:5435", // timescaledb
  "tcp:0.0.0.0:5437", // voice-postgres
  "tcp:0.0.0.0:5438", // ais-prod-postgres
  "tcp:0.0.0.0:5440", // gons-dashboard-postgres
  "tcp:0.0.0.0:6380", // news-prod-redis
  "tcp:0.0.0.0:6382", // voice-redis
  "tcp:0.0.0.0:6385", // ais-prod-redis
  "tcp:0.0.0.0:6390", // gons-dashboard-redis
  "tcp:0.0.0.0:8000",
  "tcp:0.0.0.0:8081",
  "tcp:0.0.0.0:8082",
  "tcp:0.0.0.0:8088",
  "tcp:0.0.0.0:8200",
  "tcp:0.0.0.0:8317", // cli-proxy-api
  "tcp:0.0.0.0:27018",
  "tcp:127.0.0.1:3001",
  "tcp:127.0.0.1:5434", // n8n-postgres (루프백 — 확장되면 드리프트로 잡힌다)
  "tcp:127.0.0.1:5436", // ais-postgres (루프백)
  "tcp:127.0.0.1:5678",
  "tcp:127.0.0.1:24282",
  "tcp:127.0.0.1:37700",
  "tcp:127.0.0.53%lo:53",
  "tcp:127.0.0.54:53",
  // IPv6 (dual-stack 리스너)
  "tcp:[::]:80",
  "tcp:[::]:139",
  "tcp:[::]:443",
  "tcp:[::]:445",
  "tcp:[::]:2222",
  "tcp:[::]:3010",
  "tcp:[::]:3020",
  "tcp:[::]:3030",
  "tcp:[::]:3100",
  "tcp:[::]:3200",
  "tcp:[::]:3300",
  "tcp:[::]:3401",
  "tcp:[::]:5435",
  "tcp:[::]:5437",
  "tcp:[::]:5438",
  "tcp:[::]:5440",
  "tcp:[::]:6380",
  "tcp:[::]:6382",
  "tcp:[::]:6385",
  "tcp:[::]:6390",
  "tcp:[::]:8000",
  "tcp:[::]:8081",
  "tcp:[::]:8082",
  "tcp:[::]:8088",
  "tcp:[::]:8200",
  "tcp:[::]:8317",
];

/** fail2ban 에 반드시 존재해야 하는 jail — 공인 IP 직접 노출 서버라 sshd 필수. */
export const EXPECTED_JAILS: readonly string[] = ["sshd"];

/** 1시간 SSH 인증 실패가 이 값을 넘으면 warning. */
export const SSH_FAIL_THRESHOLD = 100;

/** collector 산출물이 이보다 오래되면 미수집 취급 (에이전트가 판단). */
export const SECURITY_SNAPSHOT_MAX_AGE_MIN = 15;
