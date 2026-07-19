// 보안 관측치 판정 — 순수 함수 (이슈 #323 §H, Phase 3).
// features/monitoring-ingest/lib/judgeChecks.ts 의 미러 구조.
//
// 판정표:
//   iptables  observed:false → unknown / present:false → critical (체인 삭제)
//             / 규칙 수·해시 불일치 → critical / 일치 → ok
//   fail2ban  observed:false → unknown / 기대 jail 부재 → warning / 그 외 ok
//   ufw       observed:false → unknown / inactive → critical / active → ok
//   portdrift observed:false → unknown / 허용목록 밖 등장 → warning / 그 외 ok
//   sshfail   observed:false → unknown / 임계 초과 → warning / 그 외 ok
//
// ⚠️ 기대되는 모든 점검에 **항상** verdict 를 생성한다. 관측치가 없다고 verdict 를
// 건너뛰면 check_results 에 새 행이 안 생겨 보드에 이전 상태가 그대로 남는다
// ("관측 공백"이 "정상"으로 보이는 미탐).
import { type CheckVerdict } from "@/features/monitoring-ingest";
import { type SecurityPayload } from "@/features/monitoring-ingest";
import {
  ALLOWED_PORTS,
  EXPECTED_IPTABLES,
  EXPECTED_JAILS,
  SSH_FAIL_THRESHOLD,
} from "../config/baseline";

/** 관측 실패 verdict — 모든 kind 공통. */
function unknownVerdict(
  kind: CheckVerdict["kind"],
  reason: string,
  label: string,
): CheckVerdict {
  return {
    kind,
    target: kind,
    status: "unknown",
    detail: { reason },
    dedupKeySuffix: `sec:${kind}`,
    title: `${label} 관측 불가 (${reason})`,
  };
}

export function judgeSecurity(payload: SecurityPayload): CheckVerdict[] {
  return [
    judgeIptables(payload.iptables),
    judgeFail2ban(payload.fail2ban),
    judgeUfw(payload.ufw),
    judgePortDrift(payload.ports),
    judgeSshFail(payload.sshFail),
  ];
}

function judgeIptables(o: SecurityPayload["iptables"]): CheckVerdict {
  const label = "DOCKER-USER 방화벽";
  if (!o) return unknownVerdict("iptables", "not-reported", label);
  if (!o.observed) return unknownVerdict("iptables", o.reason, label);

  // 체인 삭제 = 인터넷 방어선 소멸. 관측 실패가 아니라 최악의 위반이다.
  if (!o.present) {
    return {
      kind: "iptables",
      target: "iptables",
      status: "critical",
      detail: { present: false },
      dedupKeySuffix: "sec:iptables",
      title: "DOCKER-USER 체인이 사라졌습니다 — 인터넷 방어선 소멸",
    };
  }

  const countDrift = o.ruleCount !== EXPECTED_IPTABLES.ruleCount;
  const hashDrift = o.specHash !== EXPECTED_IPTABLES.specHash;
  const detail = {
    present: true,
    ruleCount: o.ruleCount,
    expectedRuleCount: EXPECTED_IPTABLES.ruleCount,
    specHash: o.specHash,
  };
  if (!countDrift && !hashDrift) {
    return {
      kind: "iptables",
      target: "iptables",
      status: "ok",
      detail,
      dedupKeySuffix: "sec:iptables",
      title: `${label} 정상 (${o.ruleCount}규칙)`,
    };
  }
  return {
    kind: "iptables",
    target: "iptables",
    status: "critical",
    detail,
    dedupKeySuffix: "sec:iptables",
    title: countDrift
      ? `DOCKER-USER 규칙 수 변경 (${EXPECTED_IPTABLES.ruleCount}→${o.ruleCount})`
      : "DOCKER-USER 규칙 내용 변경 (해시 불일치)",
  };
}

function judgeFail2ban(o: SecurityPayload["fail2ban"]): CheckVerdict {
  const label = "fail2ban";
  if (!o) return unknownVerdict("fail2ban", "not-reported", label);
  if (!o.observed) return unknownVerdict("fail2ban", o.reason, label);

  // 개수가 아니라 "기대 jail 의 존재"를 본다 — jailCount>0 만 보면
  // sshd 가 빠지고 다른 jail 이 늘어난 상황을 정상으로 오판한다.
  const missing = EXPECTED_JAILS.filter((j) => !o.jails.includes(j));
  const detail = { jails: [...o.jails], missing };
  return missing.length > 0
    ? {
        kind: "fail2ban",
        target: "fail2ban",
        status: "warning",
        detail,
        dedupKeySuffix: "sec:fail2ban",
        title: `fail2ban jail 누락: ${missing.join(", ")}`,
      }
    : {
        kind: "fail2ban",
        target: "fail2ban",
        status: "ok",
        detail,
        dedupKeySuffix: "sec:fail2ban",
        title: `${label} 정상 (${o.jails.length} jail)`,
      };
}

function judgeUfw(o: SecurityPayload["ufw"]): CheckVerdict {
  const label = "ufw";
  if (!o) return unknownVerdict("ufw", "not-reported", label);
  if (!o.observed) return unknownVerdict("ufw", o.reason, label);
  return {
    kind: "ufw",
    target: "ufw",
    status: o.active ? "ok" : "critical",
    detail: { active: o.active },
    dedupKeySuffix: "sec:ufw",
    title: o.active ? "ufw 활성" : "ufw 가 비활성 상태입니다",
  };
}

function judgePortDrift(o: SecurityPayload["ports"]): CheckVerdict {
  const label = "리스닝 포트";
  if (!o) return unknownVerdict("portdrift", "not-reported", label);
  if (!o.observed) return unknownVerdict("portdrift", o.reason, label);

  // 사라진 포트는 무이벤트 — 서비스 중단은 service/http 체크가 잡는다.
  // 여기서 보는 것은 "의도하지 않은 노출 확대" 뿐이다.
  const unexpected = o.entries.filter((e) => !ALLOWED_PORTS.includes(e));
  const detail = { count: o.entries.length, unexpected };
  return unexpected.length > 0
    ? {
        kind: "portdrift",
        target: "portdrift",
        status: "warning",
        detail,
        dedupKeySuffix: "sec:portdrift",
        title: `허용목록 밖 리스닝 소켓 ${unexpected.length}건: ${unexpected.slice(0, 5).join(", ")}`,
      }
    : {
        kind: "portdrift",
        target: "portdrift",
        status: "ok",
        detail,
        dedupKeySuffix: "sec:portdrift",
        title: `${label} 정상 (${o.entries.length}개)`,
      };
}

function judgeSshFail(o: SecurityPayload["sshFail"]): CheckVerdict {
  const label = "SSH 인증 실패";
  if (!o) return unknownVerdict("sshfail", "not-reported", label);
  if (!o.observed) return unknownVerdict("sshfail", o.reason, label);
  const over = o.failCount1h > SSH_FAIL_THRESHOLD;
  return {
    kind: "sshfail",
    target: "sshfail",
    status: over ? "warning" : "ok",
    detail: { failCount1h: o.failCount1h, threshold: SSH_FAIL_THRESHOLD },
    dedupKeySuffix: "sec:sshfail",
    title: over
      ? `SSH 인증 실패 급증 (1시간 ${o.failCount1h}회, 임계 ${SSH_FAIL_THRESHOLD})`
      : `${label} 정상 (1시간 ${o.failCount1h}회)`,
  };
}
