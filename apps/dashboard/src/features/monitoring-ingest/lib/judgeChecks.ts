// checks payload 판정 — 순수 함수 (이슈 #323 Phase 2, §C·D).
//
// 판정표 (계획 문서 2026-07-19-monitoring-phase2.md):
//   service:  active=="active"→ok / "failed"→critical / 그 외→warning
//   timer:    result!="success"→warning / nextElapse 가 30분 이상 과거→warning(지연)
//             / 관찰치 전무→unknown / 그 외 ok
//   hostcron: !readable 또는 mtime 없음→unknown(무이벤트)
//             / age>2×maxAge→critical / age>maxAge→warning / 그 외 ok
//
// status 소비 규칙: critical|warning→recordEvent, ok→resolveEvent, unknown→no-op.
import { type ChecksPayload } from "../model/checksSchema";

export interface CheckVerdict {
  kind: "service" | "timer" | "hostcron";
  target: string;
  status: "ok" | "warning" | "critical" | "unknown";
  detail: Record<string, string | number | boolean>;
  /** recordEvent dedupKey 접미 — hostId 는 호출부가 접두한다. */
  dedupKeySuffix: string;
  /** 위반 시 이벤트 제목. */
  title: string;
}

/** 타이머 다음 예정 시각이 이만큼 과거면 "지연" 경고. */
const TIMER_LATE_GRACE_MS = 30 * 60_000;

export function judgeChecks(payload: ChecksPayload, now: Date): CheckVerdict[] {
  const verdicts: CheckVerdict[] = [];

  for (const svc of payload.services ?? []) {
    const status =
      svc.active === "active"
        ? "ok"
        : svc.active === "failed"
          ? "critical"
          : "warning";
    verdicts.push({
      kind: "service",
      target: svc.unit,
      status,
      detail: {
        active: svc.active,
        ...(svc.nRestarts != null ? { nRestarts: svc.nRestarts } : {}),
      },
      dedupKeySuffix: `svc:${svc.unit}`,
      title: `${svc.unit} 서비스 ${svc.active}`,
    });
  }

  for (const timer of payload.timers ?? []) {
    const observed =
      timer.result != null ||
      timer.lastTriggerEpoch != null ||
      timer.nextElapseEpoch != null;
    const failed = timer.result != null && timer.result !== "success";
    const late =
      timer.nextElapseEpoch != null &&
      timer.nextElapseEpoch * 1000 < now.getTime() - TIMER_LATE_GRACE_MS;
    const status = !observed
      ? "unknown"
      : failed || late
        ? "warning"
        : "ok";
    verdicts.push({
      kind: "timer",
      target: timer.unit,
      status,
      detail: {
        ...(timer.result != null ? { result: timer.result } : {}),
        ...(timer.lastTriggerEpoch != null
          ? { lastTriggerEpoch: timer.lastTriggerEpoch }
          : {}),
        ...(timer.nextElapseEpoch != null
          ? { nextElapseEpoch: timer.nextElapseEpoch }
          : {}),
      },
      dedupKeySuffix: `timer:${timer.unit}`,
      title: failed
        ? `${timer.unit} 마지막 실행 실패 (${timer.result})`
        : `${timer.unit} 타이머 지연 (예정 시각 30분+ 경과)`,
    });
  }

  for (const job of payload.hostCron ?? []) {
    if (!job.readable || job.mtimeEpoch == null) {
      verdicts.push({
        kind: "hostcron",
        target: job.name,
        status: "unknown",
        detail: { readable: job.readable, maxAgeMin: job.maxAgeMin },
        dedupKeySuffix: `hostcron:${job.name}`,
        title: `${job.name} cron 로그 읽기 불가`,
      });
      continue;
    }
    const ageMin = Math.round(
      (now.getTime() - job.mtimeEpoch * 1000) / 60_000,
    );
    const status =
      ageMin > job.maxAgeMin * 2
        ? "critical"
        : ageMin > job.maxAgeMin
          ? "warning"
          : "ok";
    verdicts.push({
      kind: "hostcron",
      target: job.name,
      status,
      detail: {
        ageMin,
        maxAgeMin: job.maxAgeMin,
        ...(job.sizeBytes != null ? { sizeBytes: job.sizeBytes } : {}),
      },
      dedupKeySuffix: `hostcron:${job.name}`,
      title: `${job.name} cron 실행 흔적 없음 (${ageMin}분 경과, 기대 ≤${job.maxAgeMin}분)`,
    });
  }

  return verdicts;
}
