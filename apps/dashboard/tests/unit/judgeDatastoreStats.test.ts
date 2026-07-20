// judgeDatastoreStats 판정표 회귀 (이슈 #323 §J).
//
// 핵심 관심사 2가지:
//   1) 수치 누락이 0 으로 떨어져 오탐이 되지 않는가 (스키마상 optional 이라 합법 조합)
//   2) 임계값이 실측 데이터를 실제로 잡는가 (1GiB 였다면 아무것도 못 잡았다)
import { describe, expect, it } from "vitest";
import {
  DATASTORE_INSTANCES,
  judgeDatastoreStats,
} from "@/features/monitoring-datastore";
import { REDIS_MEM_WARN_BYTES } from "@/features/monitoring-datastore/config/thresholds";
import { checksPayloadSchema } from "@/features/monitoring-ingest";

const PG = DATASTORE_INSTANCES.find((i) => i.kind === "pg")!;
const REDIS = DATASTORE_INSTANCES.find((i) => i.kind === "redis")!;
const MIB = 1024 * 1024;

function find(
  v: ReturnType<typeof judgeDatastoreStats>,
  kind: string,
  target: string,
) {
  return v.find((x) => x.kind === kind && x.target === target)!;
}

function pgStat(conns: number, maxConns: number, sizeBytes?: number) {
  return judgeDatastoreStats([
    { kind: "pg" as const, target: PG.target, observed: true, conns, maxConns, sizeBytes },
  ]);
}

describe("judgeDatastoreStats — 관측 공백", () => {
  it("payload 가 없어도 전 인스턴스에 verdict 를 만든다", () => {
    const v = judgeDatastoreStats(undefined);
    expect(v).toHaveLength(DATASTORE_INSTANCES.length);
    expect(v.every((x) => x.status === "unknown")).toBe(true);
  });

  it("observed:true 인데 수치가 없으면 unknown — 0 으로 떨어지지 않는다", () => {
    // 스키마상 conns/maxConns 는 optional 이라 이 조합이 합법이다.
    // 그대로 나눗셈에 넣으면 0/0=NaN 또는 0% 로 ok 가 되어 관측 실패가 정상으로 보인다.
    const v = find(
      judgeDatastoreStats([{ kind: "pg", target: PG.target, observed: true }]),
      "pgstat",
      PG.target,
    );
    expect(v.status).toBe("unknown");
    expect(v.detail.reason).toBe("no-metrics");
  });

  it("maxConns 가 0 이면 unknown — Infinity 로 critical 오탐 방지", () => {
    const v = find(pgStat(5, 0), "pgstat", PG.target);
    expect(v.status).toBe("unknown");
  });

  it("Redis memBytes 누락도 unknown", () => {
    const v = find(
      judgeDatastoreStats([{ kind: "redis", target: REDIS.target, observed: true, conns: 3 }]),
      "redisstat",
      REDIS.target,
    );
    expect(v.status).toBe("unknown");
    expect(v.detail.reason).toBe("no-metrics");
  });
});

describe("judgeDatastoreStats — PG 연결 임계", () => {
  it("90% 이상은 critical (연결 고갈 임박)", () => {
    expect(find(pgStat(90, 100), "pgstat", PG.target).status).toBe("critical");
  });

  it("75~89% 는 warning", () => {
    expect(find(pgStat(75, 100), "pgstat", PG.target).status).toBe("warning");
    expect(find(pgStat(89, 100), "pgstat", PG.target).status).toBe("warning");
  });

  it("74% 이하는 ok — 경계 직전이 경고로 새지 않는다", () => {
    expect(find(pgStat(74, 100), "pgstat", PG.target).status).toBe("ok");
  });

  it("실측값(12/100)은 ok — 정상 운영에서 오탐이 없다", () => {
    // 2026-07-20 운영 실측: 7개 PG 인스턴스가 6~12/100.
    expect(find(pgStat(12, 100), "pgstat", PG.target).status).toBe("ok");
  });

  it("DB 크기는 detail 에 기록되지만 판정을 바꾸지 않는다", () => {
    // 증가율 없이 절대 크기로 판정하면 오탐만 만든다 — 기록만 한다.
    const huge = find(pgStat(10, 100, 500 * 1024 ** 3), "pgstat", PG.target);
    expect(huge.status).toBe("ok");
    expect(huge.detail.sizeBytes).toBe(500 * 1024 ** 3);
  });
});

describe("judgeDatastoreStats — Redis 메모리 임계", () => {
  it("임계 미만은 ok", () => {
    const v = find(
      judgeDatastoreStats([
        { kind: "redis", target: REDIS.target, observed: true, memBytes: 2 * MIB },
      ]),
      "redisstat",
      REDIS.target,
    );
    expect(v.status).toBe("ok");
  });

  it("실측 이상치(799.8MiB)를 warning 으로 잡는다", () => {
    // ⚠️ 이 테스트가 임계값 설계의 핵심 가드다. 임계를 1GiB 로 올리면 이 케이스가
    // ok 로 바뀌어, 현재 유일한 이상 인스턴스를 놓친 채 배포된다.
    const v = find(
      judgeDatastoreStats([
        { kind: "redis", target: REDIS.target, observed: true, memBytes: 838679592 },
      ]),
      "redisstat",
      REDIS.target,
    );
    expect(v.status).toBe("warning");
  });

  it("정상 인스턴스(1~2MiB)와 임계 사이에 충분한 여유가 있다", () => {
    // 오탐 여지 확인 — 정상군의 최대치(2MiB)가 임계의 1% 미만이어야 한다.
    expect(2 * MIB).toBeLessThan(REDIS_MEM_WARN_BYTES * 0.01);
  });
});

describe("judgeDatastoreStats — 식별·중복", () => {
  it("liveness 와 다른 dedupKey 를 쓴다 (한쪽 해소가 다른 쪽을 지우지 않도록)", () => {
    const v = judgeDatastoreStats(undefined);
    expect(v.every((x) => x.dedupKeySuffix.startsWith("dsx:"))).toBe(true);
  });

  it("dedupKeySuffix 가 인스턴스마다 유일하다", () => {
    const keys = judgeDatastoreStats(undefined).map((x) => x.dedupKeySuffix);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("중복 보고는 순서와 무관하게 unknown(duplicate-report)", () => {
    const a = { kind: "pg" as const, target: PG.target, observed: true, conns: 5, maxConns: 100 };
    const b = { kind: "pg" as const, target: PG.target, observed: false, reason: "x" };
    for (const obs of [[a, b], [b, a]]) {
      expect(find(judgeDatastoreStats(obs), "pgstat", PG.target).detail.reason).toBe(
        "duplicate-report",
      );
    }
  });

  it("미노출 인스턴스도 심층지표는 관측된다 (Phase 3 와의 차이)", () => {
    // docker exec 채널은 네트워크 노출과 무관하다 — port 없는 인스턴스가
    // liveness 에서는 영구 not-exposed 지만 여기서는 정상 판정을 받는다.
    const unexposed = DATASTORE_INSTANCES.find((i) => i.port == null && i.kind === "pg")!;
    const v = find(
      judgeDatastoreStats([
        { kind: "pg", target: unexposed.target, observed: true, conns: 6, maxConns: 100 },
      ]),
      "pgstat",
      unexposed.target,
    );
    expect(v.status).toBe("ok");
  });
});

describe("checksPayloadSchema — datastoreStats", () => {
  // 판정 테스트는 객체 리터럴로 스키마를 우회하므로 파싱을 따로 고정한다(PR-A 교훈).
  it("정상 관측치를 파싱한다", () => {
    const r = checksPayloadSchema.safeParse({
      host: "home-server",
      datastoreStats: [
        { kind: "pg", target: "gons-dashboard", observed: true, conns: 12, maxConns: 100, sizeBytes: 68582423 },
        { kind: "redis", target: "ais-prod", observed: true, conns: 34, memBytes: 838679592 },
        { kind: "pg", target: "sms-insights", observed: false, reason: "container-missing" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("음수 수치를 거부한다", () => {
    const r = checksPayloadSchema.safeParse({
      host: "home-server",
      datastoreStats: [{ kind: "pg", target: "x", observed: true, conns: -1 }],
    });
    expect(r.success).toBe(false);
  });

  it("datastoreStats 가 없어도 유효하다 (에이전트 미갱신 호환)", () => {
    expect(checksPayloadSchema.safeParse({ host: "home-server" }).success).toBe(true);
  });
});
