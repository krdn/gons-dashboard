// 보안 관제 (이슈 #323 §H, Phase 3) — 판정은 순수 함수라 server-only 가 아니다.
// 수집은 호스트 root collector(scripts/monitoring-agent/gons-security-collect.sh)가,
// 중계는 에이전트가, 판정·저장은 monitoring-ingest 가 한다.
export { judgeSecurity } from "./lib/judgeSecurity";
export {
  ALLOWED_PORTS,
  EXPECTED_IPTABLES,
  EXPECTED_JAILS,
  SSH_FAIL_THRESHOLD,
  SECURITY_SNAPSHOT_MAX_AGE_MIN,
} from "./config/baseline";
