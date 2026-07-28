import { describe, it, expect } from "vitest";
import {
  POLICIES,
  RESTART_EXCLUDED,
  REDIS_MAX_CAP_BYTES,
  type OpenEventView,
  type LiveFacts,
} from "@/features/monitoring-remediate/config/policies";

const facts: LiveFacts = {
  hostAvailableMemBytes: 13 * 1024 ** 3,
  containerExcluded: (n) => RESTART_EXCLUDED.some((x) => n.includes(x)),
};

function ev(over: Partial<OpenEventView>): OpenEventView {
  return {
    id: "e1",
    dedupKey: "k1",
    severity: "critical",
    source: "host",
    title: "t",
    detail: null,
    occurredAt: new Date("2026-07-28T10:00:00Z"),
    hostId: "h1",
    ...over,
  };
}

describe("redis maxmemory 정책", () => {
  const policy = POLICIES.find((p) => p.id === "redis-maxmemory")!;

  it("noeviction + 임계 초과면 상향 조치 생성", () => {
    const action = policy.buildAction(
      ev({
        detail: JSON.stringify({
          usedPct: 78,
          evictionPolicy: "noeviction",
          maxMemBytes: 1073741824,
          target: "ais-prod",
        }),
      }),
      facts,
    );
    expect(action).toMatchObject({ kind: "raise-redis-maxmemory", target: "ais-prod" });
    expect((action as { nextBytes: number }).nextBytes).toBe(2 * 1073741824);
  });

  // 수동 복구에서 얻은 교훈: 호스트 여유를 확인하지 않고 상한을 올리면
  // 호스트 자체가 OOM 에 빠진다. 실측값 없이는 조치하지 않는다.
  it("호스트 여유 메모리를 모르면 skip", () => {
    const action = policy.buildAction(
      ev({
        detail: JSON.stringify({
          usedPct: 78,
          evictionPolicy: "noeviction",
          maxMemBytes: 1073741824,
          target: "ais-prod",
        }),
      }),
      { ...facts, hostAvailableMemBytes: null },
    );
    expect(action).toMatchObject({ skip: expect.stringContaining("여유") });
  });

  it("증가분이 호스트 여유를 넘으면 skip", () => {
    const action = policy.buildAction(
      ev({
        detail: JSON.stringify({
          usedPct: 78,
          evictionPolicy: "noeviction",
          maxMemBytes: 1073741824,
          target: "ais-prod",
        }),
      }),
      { ...facts, hostAvailableMemBytes: 100 * 1024 ** 2 },
    );
    expect(action).toMatchObject({ skip: expect.stringContaining("여유") });
  });

  it("절대 상한 캡을 넘으면 skip", () => {
    const action = policy.buildAction(
      ev({
        detail: JSON.stringify({
          usedPct: 95,
          evictionPolicy: "noeviction",
          maxMemBytes: REDIS_MAX_CAP_BYTES,
          target: "ais-prod",
        }),
      }),
      facts,
    );
    expect(action).toMatchObject({ skip: expect.stringContaining("상한") });
  });

  it("allkeys-lru 는 대상 아님 (축출로 정상 동작)", () => {
    const action = policy.buildAction(
      ev({
        detail: JSON.stringify({
          usedPct: 95,
          evictionPolicy: "allkeys-lru",
          maxMemBytes: 1073741824,
          target: "n8n",
        }),
      }),
      facts,
    );
    expect(action).toMatchObject({ skip: expect.any(String) });
  });

  it("detail 이 JSON 이 아니면 skip (실측값 없이 조치 금지)", () => {
    const action = policy.buildAction(ev({ detail: "not json" }), facts);
    expect(action).toMatchObject({ skip: expect.any(String) });
  });
});

describe("컨테이너 재시작 정책", () => {
  const policy = POLICIES.find((p) => p.id === "restart-container")!;

  it("제외목록 컨테이너는 skip", () => {
    const action = policy.buildAction(
      ev({
        source: "container",
        detail: JSON.stringify({ containerName: "gons-dashboard-postgres", containerId: "abc123def456" }),
      }),
      facts,
    );
    expect(action).toMatchObject({ skip: expect.stringContaining("제외") });
  });

  it("일반 컨테이너는 재시작 조치 생성", () => {
    const action = policy.buildAction(
      ev({
        source: "container",
        detail: JSON.stringify({ containerName: "some-web", containerId: "abc123def456" }),
      }),
      facts,
    );
    expect(action).toMatchObject({ kind: "restart-container", containerName: "some-web" });
  });

  it("containerId 형식이 hex 가 아니면 skip (path traversal 방어)", () => {
    const action = policy.buildAction(
      ev({
        source: "container",
        detail: JSON.stringify({ containerName: "x", containerId: "../../etc/passwd" }),
      }),
      facts,
    );
    expect(action).toMatchObject({ skip: expect.any(String) });
  });
});

describe("정책 공통", () => {
  it("모든 정책은 maxAttempts 와 cooldownMinutes 를 갖는다", () => {
    for (const p of POLICIES) {
      expect(p.maxAttempts).toBeGreaterThan(0);
      expect(p.cooldownMinutes).toBeGreaterThan(0);
    }
  });

  it("정책 id 는 유일하다", () => {
    const ids = POLICIES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("상태 보유 서비스가 재시작 제외목록에 있다", () => {
    expect(RESTART_EXCLUDED).toContain("postgres");
    expect(RESTART_EXCLUDED).toContain("redis");
  });
});
