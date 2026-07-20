// 데이터스토어 심층지표 판정 — 순수 함수 (이슈 #323 §J, Phase 4).
// judgeDatastores.ts(liveness)의 미러 구조.
//
// 판정표:
//   payload 에 (kind,target) 없음  → unknown(not-reported)
//   observed:false                 → unknown(collector 사유)
//   수치 누락                      → unknown(no-metrics) — 0 으로 떨어지면 오탐
//   PG conns/maxConns ≥ 0.9        → critical (연결 고갈 임박 = 앱 장애 직결)
//   PG conns/maxConns ≥ 0.75       → warning
//   Redis memBytes ≥ 512MiB        → warning (절대 임계 — thresholds.ts 근거 참조)
//   그 외                          → ok
//
// ⚠️ DB 크기는 **기록만 하고 판정하지 않는다.** 1회 관측으로는 정상 증가와 이상
// 증가를 구분할 수 없다(증가율이 필요). 임의 절대 임계는 오탐만 만든다.
import { type CheckVerdict } from "@/features/monitoring-ingest";
import { type ChecksPayload } from "@/features/monitoring-ingest";
import { DATASTORE_INSTANCES, type DatastoreInstance } from "../config/instances";
import {
  PG_CONN_CRITICAL_RATIO,
  PG_CONN_WARN_RATIO,
  REDIS_MEM_CRITICAL_RATIO,
  REDIS_MEM_WARN_BYTES,
  REDIS_MEM_WARN_RATIO,
  REDIS_NO_EVICTION_POLICY,
} from "../config/thresholds";

type StatObservation = NonNullable<ChecksPayload["datastoreStats"]>[number];

/** liveness 와 같은 복합키 규약 — 구분자는 NUL(target 에 나타날 수 없음). */
function keyOf(kind: string, target: string): string {
  return `${kind}\u0000${target}`;
}

function label(inst: DatastoreInstance): string {
  return `${inst.kind === "pg" ? "PostgreSQL" : "Redis"} ${inst.target}`;
}

/**
 * dedupKey 접미. liveness(`ds:`)와 **다른 접두사**를 쓴다 — 같은 인스턴스의
 * "응답 없음"과 "연결 고갈"은 별개 사건이라 한쪽 해소가 다른 쪽을 지우면 안 된다.
 */
function dedupSuffix(inst: DatastoreInstance): string {
  return `dsx:${inst.kind}:${inst.target}`;
}

function unknownVerdict(inst: DatastoreInstance, reason: string): CheckVerdict {
  return {
    kind: inst.kind === "pg" ? "pgstat" : "redisstat",
    target: inst.target,
    status: "unknown",
    detail: { reason },
    dedupKeySuffix: dedupSuffix(inst),
    title: `${label(inst)} 지표 관측 불가 (${reason})`,
  };
}

/**
 * 심층지표 판정. payload 가 비어도 **항상 전 인스턴스를 반환**한다 —
 * verdict 를 건너뛰면 새 행이 안 생겨 보드에 직전 상태가 남는다(Phase 3 와 동일).
 */
export function judgeDatastoreStats(
  observations: ChecksPayload["datastoreStats"],
): CheckVerdict[] {
  const byKey = new Map<string, StatObservation>();
  const duplicated = new Set<string>();
  for (const o of observations ?? []) {
    const k = keyOf(o.kind, o.target);
    if (byKey.has(k)) duplicated.add(k);
    byKey.set(k, o);
  }

  return DATASTORE_INSTANCES.map((inst) => {
    const key = keyOf(inst.kind, inst.target);
    if (duplicated.has(key)) return unknownVerdict(inst, "duplicate-report");

    const o = byKey.get(key);
    if (!o) return unknownVerdict(inst, "not-reported");
    if (!o.observed) return unknownVerdict(inst, o.reason ?? "not-observed");

    return inst.kind === "pg" ? judgePg(inst, o) : judgeRedis(inst, o);
  });
}

function judgePg(inst: DatastoreInstance, o: StatObservation): CheckVerdict {
  // maxConns 가 0 이면 나눗셈이 Infinity — 관측 실패로 다룬다.
  if (o.conns == null || o.maxConns == null || o.maxConns === 0) {
    return unknownVerdict(inst, "no-metrics");
  }
  const ratio = o.conns / o.maxConns;
  const pct = Math.round(ratio * 100);
  const detail = {
    conns: o.conns,
    maxConns: o.maxConns,
    usedPct: pct,
    // 크기는 판정 근거가 아니라 기록 — 추세 판정은 다운샘플 도입 후.
    ...(o.sizeBytes != null ? { sizeBytes: o.sizeBytes } : {}),
  };
  const base = {
    kind: "pgstat" as const,
    target: inst.target,
    detail,
    dedupKeySuffix: dedupSuffix(inst),
  };

  if (ratio >= PG_CONN_CRITICAL_RATIO) {
    return {
      ...base,
      status: "critical",
      title: `${label(inst)} 연결 고갈 임박 (${o.conns}/${o.maxConns}, ${pct}%)`,
    };
  }
  if (ratio >= PG_CONN_WARN_RATIO) {
    return {
      ...base,
      status: "warning",
      title: `${label(inst)} 연결 사용률 높음 (${o.conns}/${o.maxConns}, ${pct}%)`,
    };
  }
  return {
    ...base,
    status: "ok",
    title: `${label(inst)} 정상 (연결 ${o.conns}/${o.maxConns})`,
  };
}

function judgeRedis(inst: DatastoreInstance, o: StatObservation): CheckVerdict {
  if (o.memBytes == null) return unknownVerdict(inst, "no-metrics");
  const mib = Math.round(o.memBytes / (1024 * 1024));
  // 상한이 있으면 비율이 1차 근거다 — 절대 크기는 위험도를 표현하지 못한다
  // (1GiB 상한의 799MiB 와 무제한의 799MiB 는 전혀 다른 상황).
  const hasCap = o.maxMemBytes != null && o.maxMemBytes > 0;
  const ratio = hasCap ? o.memBytes / o.maxMemBytes! : null;
  const pct = ratio != null ? Math.round(ratio * 100) : null;
  // noeviction 은 상한 도달 시 축출이 아니라 쓰기 실패 — 같은 사용률이라도 더 위험.
  const noEvict = o.evictionPolicy === REDIS_NO_EVICTION_POLICY;

  const detail = {
    memBytes: o.memBytes,
    memMib: mib,
    ...(o.maxMemBytes != null ? { maxMemBytes: o.maxMemBytes } : {}),
    ...(pct != null ? { usedPct: pct } : {}),
    ...(o.evictionPolicy != null ? { evictionPolicy: o.evictionPolicy } : {}),
    ...(o.conns != null ? { conns: o.conns } : {}),
  };
  const base = {
    kind: "redisstat" as const,
    target: inst.target,
    detail,
    dedupKeySuffix: dedupSuffix(inst),
  };
  const cap = hasCap ? `${Math.round(o.maxMemBytes! / (1024 * 1024))}MiB` : "무제한";

  if (ratio != null) {
    // noeviction 이면 상한 도달이 곧 쓰기 실패라 critical 을 한 단계 앞당긴다.
    if (ratio >= REDIS_MEM_CRITICAL_RATIO || (noEvict && ratio >= REDIS_MEM_WARN_RATIO)) {
      return {
        ...base,
        status: noEvict ? "critical" : "warning",
        title: noEvict
          ? `${label(inst)} 메모리 ${pct}% (${mib}/${cap}) — noeviction 이라 상한 도달 시 쓰기 실패`
          : `${label(inst)} 메모리 ${pct}% (${mib}/${cap})`,
      };
    }
    if (ratio >= REDIS_MEM_WARN_RATIO) {
      return {
        ...base,
        status: "warning",
        title: `${label(inst)} 메모리 ${pct}% (${mib}/${cap})`,
      };
    }
    return { ...base, status: "ok", title: `${label(inst)} 정상 (${mib}/${cap}, ${pct}%)` };
  }

  // 상한 없음 — 분모가 없어 절대 임계로만 본다.
  return o.memBytes >= REDIS_MEM_WARN_BYTES
    ? {
        ...base,
        status: "warning",
        title: `${label(inst)} 메모리 ${mib}MiB (상한 없음, 임계 ${Math.round(REDIS_MEM_WARN_BYTES / (1024 * 1024))}MiB)`,
      }
    : { ...base, status: "ok", title: `${label(inst)} 정상 (${mib}MiB, 상한 없음)` };
}
