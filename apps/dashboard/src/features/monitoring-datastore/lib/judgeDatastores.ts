// DB/Redis liveness 판정 — 순수 함수 (이슈 #323 §G, Phase 3).
// features/monitoring-security/lib/judgeSecurity.ts 의 미러 구조.
//
// 판정표 (스펙 §B-1):
//   instances.ts 에 port 없음      → unknown(not-exposed)   — payload 무관
//   payload 에 (kind,target) 없음  → unknown(not-reported)  — 낡은 env 노출
//   payload.port ≠ 기대 port       → unknown(spec-mismatch) — 엉뚱한 포트 ok 차단
//   observed:false                 → unknown(에이전트 사유)
//   reachable:false                → critical
//   reachable:true                 → ok
//
// ⚠️ instances.ts 를 기준으로 순회한다 — payload 를 순회하면 에이전트 env 에서
// 빠진 인스턴스가 조용히 점검 대상에서 사라진다("관측 공백"이 안 보임).
import { type CheckVerdict } from "@/features/monitoring-ingest";
import { type ChecksPayload } from "@/features/monitoring-ingest";
import { DATASTORE_INSTANCES, type DatastoreInstance } from "../config/instances";

type DatastoreObservation = NonNullable<ChecksPayload["datastores"]>[number];

/**
 * (kind, target) 복합 식별자. gons-dashboard·ais-prod·voice 는 PG 와 Redis
 * 양쪽에 같은 이름으로 존재해 target 만으로는 Redis 관측치가 PG 행에 붙는다.
 *
 * §H 의 `<host>:<kind>` 와 달리 host 를 넣지 않는 이유: 데이터스토어는 kind 가
 * 이미 대상별로 갈리고(target 이 인스턴스명), 이 목록은 운영 호스트 한 곳의
 * 것이다. 다중 호스트가 같은 인스턴스명을 보고하면 그때 host 를 접두한다.
 */
function keyOf(kind: string, target: string): string {
  // 구분자는 NUL — target 에 나타날 수 없어 ("pg","a:b") 와 ("pg:a","b") 같은
  // 조합이 같은 키로 뭉치지 않는다. 소스에는 반드시 \u0000 **이스케이프**로
  // 쓸 것 — 리터럴 NUL 바이트를 넣으면 git 이 파일 전체를 바이너리로 취급해
  // PR diff 가 "Binary file not shown" 이 되고 리뷰가 불가능해진다(실제 발생).
  return `${kind}\u0000${target}`;
}

function unknownVerdict(
  inst: DatastoreInstance,
  reason: string,
): CheckVerdict {
  return {
    kind: inst.kind,
    target: inst.target,
    status: "unknown",
    detail: { reason, ...(inst.port != null ? { expectedPort: inst.port } : {}) },
    dedupKeySuffix: `ds:${inst.kind}:${inst.target}`,
    title: `${label(inst)} 관측 불가 (${reason})`,
  };
}

function label(inst: DatastoreInstance): string {
  return `${inst.kind === "pg" ? "PostgreSQL" : "Redis"} ${inst.target}`;
}

/**
 * 데이터스토어 liveness 판정. payload 가 비어도(에이전트 미설정) **항상 전 인스턴스를
 * 반환**한다 — verdict 를 건너뛰면 새 행이 안 생겨 보드에 직전 상태가 남는다(§H 와 동일).
 */
export function judgeDatastores(
  observations: ChecksPayload["datastores"],
  /**
   * Phase 4 §J 심층지표 관측치. 포트 미노출 인스턴스는 네트워크로 프로브할 수
   * 없지만 docker exec 로는 관측되므로, 그 관측이 있으면 liveness 를 승격한다.
   */
  statObservations?: ChecksPayload["datastoreStats"],
): CheckVerdict[] {
  // 같은 (kind,target) 이 두 번 오면 마지막 값이 앞선 값을 조용히 덮는다 —
  // observed:false 와 reachable:true 가 함께 오면 배열 순서가 판정을 가른다.
  // 충돌은 근거가 모순된 상태이므로 ok/critical 어느 쪽으로도 밀지 않고 unknown 이다.
  // 미노출 인스턴스 승격용 — docker exec 로 실제 관측된 (kind,target) 집합.
  // observed:true 만 인정한다(관측 실패는 근거가 아니다).
  // ⚠️ observed:true 만으로는 부족하다 — 스키마상 수치 없는 observed:true 가 합법이고
  // 심층 판정은 그것을 unknown(no-metrics)으로 처리한다. 그대로 승격하면 liveness 는
  // ok, 지표는 unknown 이라는 **모순된 한 줄**이 나온다. 실제 수치가 있는 성공
  // 판정만 근거로 인정한다. 중복 보고도 근거가 모순이므로 제외한다.
  const statSeen = new Set<string>();
  const statDup = new Set<string>();
  const statObserved = new Set<string>();
  for (const o of statObservations ?? []) {
    const k = keyOf(o.kind, o.target);
    if (statSeen.has(k)) statDup.add(k);
    statSeen.add(k);
    const hasMetrics =
      o.kind === "pg"
        ? o.conns != null && o.maxConns != null && o.maxConns > 0
        : o.memBytes != null;
    if (o.observed && hasMetrics) statObserved.add(k);
    else statObserved.delete(k);
  }
  for (const k of statDup) statObserved.delete(k);
  const byKey = new Map<string, DatastoreObservation>();
  const duplicated = new Set<string>();
  for (const o of observations ?? []) {
    const k = keyOf(o.kind, o.target);
    if (byKey.has(k)) duplicated.add(k);
    byKey.set(k, o);
  }

  return DATASTORE_INSTANCES.map((inst) => {
    // 미노출: 네트워크 프로브로는 판정 근거가 없다. 다만 Phase 4 부터는
    // docker exec 채널이 같은 인스턴스를 관측하므로, 그 관측이 있으면 승격한다 —
    // "살아있다는 증거가 있는데 보드는 회색"이 되지 않도록.
    // 승격 근거가 없으면 종전대로 not-exposed unknown 을 유지한다.
    if (inst.port == null) {
      return statObserved.has(keyOf(inst.kind, inst.target))
        ? {
            kind: inst.kind,
            target: inst.target,
            status: "ok",
            detail: { reachable: true, via: "docker-exec" },
            dedupKeySuffix: `ds:${inst.kind}:${inst.target}`,
            title: `${label(inst)} 정상 (docker exec)`,
          }
        : unknownVerdict(inst, "not-exposed");
    }

    const key = keyOf(inst.kind, inst.target);
    if (duplicated.has(key)) return unknownVerdict(inst, "duplicate-report");

    const o = byKey.get(key);
    if (!o) return unknownVerdict(inst, "not-reported");

    // 에이전트 env 가 낡아 다른 포트를 점검했다면 그 결과는 이 인스턴스의
    // 근거가 아니다. ok 로 통과시키면 엉뚱한 포트의 liveness 를 이 인스턴스의
    // 것으로 오인한다.
    if (o.port !== inst.port) {
      return {
        ...unknownVerdict(inst, "spec-mismatch"),
        detail: {
          reason: "spec-mismatch",
          expectedPort: inst.port,
          ...(o.port != null ? { reportedPort: o.port } : {}),
        },
      };
    }

    if (!o.observed) return unknownVerdict(inst, o.reason ?? "not-observed");

    // observed:true 인데 reachable 이 없으면 에이전트 계약 위반 — ok 로
    // 넘기지 않고 관측 불가로 드러낸다.
    if (o.reachable == null) return unknownVerdict(inst, "no-result");

    const detail = { port: inst.port, reachable: o.reachable };
    return o.reachable
      ? {
          kind: inst.kind,
          target: inst.target,
          status: "ok" as const,
          detail,
          dedupKeySuffix: `ds:${inst.kind}:${inst.target}`,
          title: `${label(inst)} 정상`,
        }
      : {
          kind: inst.kind,
          target: inst.target,
          status: "critical" as const,
          detail,
          dedupKeySuffix: `ds:${inst.kind}:${inst.target}`,
          title: `${label(inst)} 응답 없음 (127.0.0.1:${inst.port})`,
        };
  });
}
