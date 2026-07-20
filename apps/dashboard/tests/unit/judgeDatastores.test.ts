// judgeDatastores 판정표 회귀 (이슈 #323 §G).
//
// 핵심 관심사: "관측 실패가 ok 로도 critical 로도 새지 않는가".
// unknown 이어야 할 6가지 경로를 각각 고정한다.
import { describe, expect, it } from "vitest";
import {
  DATASTORE_INSTANCES,
  judgeDatastores,
} from "@/features/monitoring-datastore";
import { checksPayloadSchema } from "@/features/monitoring-ingest";

/** 노출 인스턴스 하나를 대표로 — 포트가 있는 첫 PG. */
const EXPOSED = DATASTORE_INSTANCES.find(
  (i) => i.kind === "pg" && i.port != null,
)!;
const NOT_EXPOSED = DATASTORE_INSTANCES.find((i) => i.port == null)!;

function find(verdicts: ReturnType<typeof judgeDatastores>, kind: string, target: string) {
  return verdicts.find((v) => v.kind === kind && v.target === target)!;
}

describe("judgeDatastores", () => {
  it("payload 가 없어도 전 인스턴스에 verdict 를 만든다 (stale 방지)", () => {
    // 행이 안 생기면 보드에 직전 판정이 그대로 남아 관측 공백이 정상처럼 보인다.
    const verdicts = judgeDatastores(undefined);
    expect(verdicts).toHaveLength(DATASTORE_INSTANCES.length);
    expect(verdicts.every((v) => v.status === "unknown")).toBe(true);
  });

  it("포트 미노출은 payload 와 무관하게 항상 unknown(not-exposed)", () => {
    // 도달할 수 없는 대상이라 어떤 관측치가 와도 판정 근거가 되지 않는다.
    const verdicts = judgeDatastores([
      {
        kind: NOT_EXPOSED.kind,
        target: NOT_EXPOSED.target,
        port: 9999,
        observed: true,
        reachable: true,
      },
    ]);
    const v = find(verdicts, NOT_EXPOSED.kind, NOT_EXPOSED.target);
    expect(v.status).toBe("unknown");
    expect(v.detail.reason).toBe("not-exposed");
  });

  it("payload 에 없는 인스턴스는 unknown(not-reported)", () => {
    const v = find(judgeDatastores([]), EXPOSED.kind, EXPOSED.target);
    expect(v.status).toBe("unknown");
    expect(v.detail.reason).toBe("not-reported");
  });

  it("기대와 다른 포트를 점검했으면 unknown(spec-mismatch) — ok 로 통과시키지 않는다", () => {
    // 낡은 env 가 엉뚱한 포트를 찔러 성공한 것을 이 인스턴스의 liveness 로
    // 오인하면, 실제로 죽어도 초록으로 보인다.
    const v = find(
      judgeDatastores([
        {
          kind: EXPOSED.kind,
          target: EXPOSED.target,
          port: EXPOSED.port! + 1,
          observed: true,
          reachable: true,
        },
      ]),
      EXPOSED.kind,
      EXPOSED.target,
    );
    expect(v.status).toBe("unknown");
    expect(v.detail.reason).toBe("spec-mismatch");
    expect(v.detail.expectedPort).toBe(EXPOSED.port);
    expect(v.detail.reportedPort).toBe(EXPOSED.port! + 1);
  });

  it("observed:false 는 에이전트 사유를 실어 unknown", () => {
    const v = find(
      judgeDatastores([
        {
          kind: EXPOSED.kind,
          target: EXPOSED.target,
          port: EXPOSED.port,
          observed: false,
          reason: "nc-missing",
        },
      ]),
      EXPOSED.kind,
      EXPOSED.target,
    );
    expect(v.status).toBe("unknown");
    expect(v.detail.reason).toBe("nc-missing");
  });

  it("observed:true 인데 reachable 이 없으면 critical 이 아니라 unknown", () => {
    // 스키마상 reachable 은 optional — 판정표대로만 짜면 undefined 가 falsy 로
    // 떨어져 critical 오탐이 된다. 근거 부재는 위반이 아니다.
    const v = find(
      judgeDatastores([
        {
          kind: EXPOSED.kind,
          target: EXPOSED.target,
          port: EXPOSED.port,
          observed: true,
        },
      ]),
      EXPOSED.kind,
      EXPOSED.target,
    );
    expect(v.status).toBe("unknown");
    expect(v.detail.reason).toBe("no-result");
  });

  it("reachable:false → critical / true → ok", () => {
    const base = {
      kind: EXPOSED.kind,
      target: EXPOSED.target,
      port: EXPOSED.port,
      observed: true,
    };
    expect(
      find(judgeDatastores([{ ...base, reachable: false }]), EXPOSED.kind, EXPOSED.target)
        .status,
    ).toBe("critical");
    expect(
      find(judgeDatastores([{ ...base, reachable: true }]), EXPOSED.kind, EXPOSED.target)
        .status,
    ).toBe("ok");
  });

  it("PG 와 Redis 의 동명 인스턴스가 서로의 판정을 덮어쓰지 않는다", () => {
    // gons-dashboard 는 PG·Redis 양쪽에 존재한다. target 만으로 매칭하면
    // Redis 관측치가 PG 행에 붙는다.
    const pg = DATASTORE_INSTANCES.find(
      (i) => i.kind === "pg" && i.target === "gons-dashboard",
    )!;
    const redis = DATASTORE_INSTANCES.find(
      (i) => i.kind === "redis" && i.target === "gons-dashboard",
    )!;
    const verdicts = judgeDatastores([
      { kind: "pg", target: "gons-dashboard", port: pg.port, observed: true, reachable: true },
      {
        kind: "redis",
        target: "gons-dashboard",
        port: redis.port,
        observed: true,
        reachable: false,
      },
    ]);
    expect(find(verdicts, "pg", "gons-dashboard").status).toBe("ok");
    expect(find(verdicts, "redis", "gons-dashboard").status).toBe("critical");
  });

  it("같은 (kind,target) 이 중복 보고되면 순서와 무관하게 unknown(duplicate-report)", () => {
    // Map.set 은 마지막 값을 남기므로, 모순된 관측치가 오면 배열 순서가 판정을
    // 가른다(observed:false 뒤에 reachable:true 가 오면 ok). 근거가 충돌하는
    // 상태는 ok 로도 critical 로도 밀지 않는다.
    const a = {
      kind: EXPOSED.kind,
      target: EXPOSED.target,
      port: EXPOSED.port,
      observed: false as const,
      reason: "nc-missing",
    };
    const b = {
      kind: EXPOSED.kind,
      target: EXPOSED.target,
      port: EXPOSED.port,
      observed: true as const,
      reachable: true,
    };
    for (const obs of [
      [a, b],
      [b, a],
    ]) {
      const v = find(judgeDatastores(obs), EXPOSED.kind, EXPOSED.target);
      expect(v.status).toBe("unknown");
      expect(v.detail.reason).toBe("duplicate-report");
    }
  });

  it("미노출 인스턴스는 docker exec 관측이 있으면 ok 로 승격된다 (§J)", () => {
    // Phase 3 에서는 영구 not-exposed 였다. Phase 4 의 docker exec 채널이
    // 실제 liveness 근거를 주므로 "살아있는데 회색"을 해소한다.
    const v = find(
      judgeDatastores([], [
        { kind: NOT_EXPOSED.kind, target: NOT_EXPOSED.target, observed: true, conns: 6, maxConns: 100 },
      ]),
      NOT_EXPOSED.kind,
      NOT_EXPOSED.target,
    );
    expect(v.status).toBe("ok");
    expect(v.detail.via).toBe("docker-exec");
  });

  it("승격 근거가 실패 관측이면 not-exposed 를 유지한다", () => {
    // observed:false 는 근거가 아니다 — 관측 실패로 ok 를 만들면 최악의 오탐.
    const v = find(
      judgeDatastores([], [
        { kind: NOT_EXPOSED.kind, target: NOT_EXPOSED.target, observed: false, reason: "exec-failed-rc1" },
      ]),
      NOT_EXPOSED.kind,
      NOT_EXPOSED.target,
    );
    expect(v.status).toBe("unknown");
    expect(v.detail.reason).toBe("not-exposed");
  });

  it("심층지표가 아예 없으면 종전대로 not-exposed", () => {
    const v = find(judgeDatastores([], undefined), NOT_EXPOSED.kind, NOT_EXPOSED.target);
    expect(v.status).toBe("unknown");
    expect(v.detail.reason).toBe("not-exposed");
  });

  it("승격은 노출 인스턴스의 판정을 바꾸지 않는다", () => {
    // 노출 인스턴스는 네트워크 프로브가 1차 근거다 — stat 이 있다고 덮으면 안 된다.
    const v = find(
      judgeDatastores(
        [{ kind: EXPOSED.kind, target: EXPOSED.target, port: EXPOSED.port, observed: true, reachable: false }],
        [{ kind: EXPOSED.kind, target: EXPOSED.target, observed: true, conns: 5, maxConns: 100 }],
      ),
      EXPOSED.kind,
      EXPOSED.target,
    );
    expect(v.status).toBe("critical");
  });

  it("dedupKeySuffix 가 인스턴스마다 유일하다", () => {
    // 겹치면 한 인스턴스의 복구가 다른 인스턴스의 이벤트를 해소한다.
    const keys = judgeDatastores(undefined).map((v) => v.dedupKeySuffix);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("checksPayloadSchema — datastores", () => {
  // PR-A 교훈: 판정 단위 테스트는 객체 리터럴을 직접 넘겨 스키마를 우회하므로
  // 스키마 자체의 결함(Zod 런타임 에러 등)을 못 잡는다. 파싱을 따로 고정한다.
  it("정상 관측치를 파싱한다", () => {
    const r = checksPayloadSchema.safeParse({
      host: "home-server",
      datastores: [
        { kind: "pg", target: "gons-dashboard", port: 5440, observed: true, reachable: true },
        { kind: "redis", target: "n8n", observed: false, reason: "not-exposed" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("알 수 없는 kind 를 거부한다", () => {
    const r = checksPayloadSchema.safeParse({
      host: "home-server",
      datastores: [{ kind: "mysql", target: "x", observed: true }],
    });
    expect(r.success).toBe(false);
  });

  it("datastores 가 없어도 유효하다 (에이전트 미갱신 호환)", () => {
    expect(checksPayloadSchema.safeParse({ host: "home-server" }).success).toBe(true);
  });
});
