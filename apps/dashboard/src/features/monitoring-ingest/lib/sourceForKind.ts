// check kind → monitoring_events.source 매핑 (Phase 3).
//
// Phase 2 까지는 "service 면 service, 나머지는 전부 cron" 이었다. Phase 3 에서
// 보안·데이터스토어 kind 가 늘면서 그 규칙이 보안 이벤트를 cron 으로 오분류하게 되어
// 명시 매핑으로 전환했다. 타임라인 필터·알림 라우팅이 source 를 근거로 하므로
// 잘못된 매핑은 사용자에게 잘못된 분류로 보인다.
import { type CheckVerdict } from "./judgeChecks";
import { type EventSource } from "@/entities/monitoring/model/types";

export function sourceForKind(kind: CheckVerdict["kind"]): EventSource {
  switch (kind) {
    case "service":
      return "service";
    case "timer":
    case "hostcron":
      return "cron";
    case "iptables":
    case "fail2ban":
    case "ufw":
    case "portdrift":
    case "sshfail":
      return "security";
    case "pg":
    case "redis":
    case "pgstat":
    case "redisstat":
      return "host";
  }
}
