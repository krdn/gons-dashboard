import { describe, it, expect } from "vitest";
import { selectActions } from "@/features/monitoring-remediate/lib/selectActions";
import { RESTART_EXCLUDED, type OpenEventView, type LiveFacts } from "@/features/monitoring-remediate/config/policies";
import { type AttemptSummary } from "@/features/monitoring-remediate/lib/guards";

const NOW = new Date("2026-07-28T12:00:00Z");
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
    occurredAt: new Date("2026-07-28T09:00:00Z"), // 180분 전
    hostId: "h1",
    ...over,
  };
}

const redisDetail = JSON.stringify({
  usedPct: 78,
  evictionPolicy: "noeviction",
  maxMemBytes: 1073741824,
  target: "ais-prod",
});

describe("selectActions", () => {
  it("조건을 만족하면 조치를 계획한다", () => {
    const r = selectActions([ev({ detail: redisDetail })], new Map(), facts, NOW);
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0]).toMatchObject({ policyId: "redis-maxmemory" });
  });

  it("지속 시간 미달이면 skip 으로 기록한다 (조용히 버리지 않는다)", () => {
    const r = selectActions(
      [ev({ detail: redisDetail, occurredAt: new Date("2026-07-28T11:50:00Z") })],
      new Map(),
      facts,
      NOW,
    );
    expect(r.actions).toHaveLength(0);
    // 정책 3종을 모두 순회하므로 사전조건 skip 도 함께 쌓인다.
    // 안전장치(guard)에 걸린 skip 을 정책 id 로 특정해 검증한다.
    const guardSkip = r.skips.find((s) => s.policyId === "redis-maxmemory")!;
    expect(guardSkip.reason).toContain("지속");
  });

  it("정책이 없는 이벤트는 아무 결과도 만들지 않는다", () => {
    const r = selectActions([ev({ detail: null, source: "ssl" })], new Map(), facts, NOW);
    expect(r.actions).toHaveLength(0);
    // 정책의 사전 조건 불충족은 skip 으로 남는다 (감사 목적)
    expect(r.skips.length).toBeGreaterThan(0);
  });

  it("이력이 시도 상한에 도달했으면 조치하지 않는다", () => {
    const history = new Map<string, AttemptSummary[]>([
      [
        "k1",
        [
          { outcome: "executed", attemptedAt: new Date("2026-07-20T00:00:00Z") },
          { outcome: "executed", attemptedAt: new Date("2026-07-21T00:00:00Z") },
        ],
      ],
    ]);
    const r = selectActions([ev({ detail: redisDetail })], history, facts, NOW);
    expect(r.actions).toHaveLength(0);
    const guardSkip = r.skips.find((s) => s.policyId === "redis-maxmemory")!;
    expect(guardSkip.reason).toContain("시도");
  });

  it("한 이벤트에 대해 조치는 최대 하나만 계획한다 (첫 매칭 정책에서 중단)", () => {
    // 정책 3종 모두에 매칭되는 detail 이어야 first-match break 의 회귀를
    // 잡는다 — redisDetail 은 마지막 정책에만 매칭돼 break 를 제거해도
    // 통과하는 무효 검증이었다. break 가 없으면 재시작 중인 컨테이너에
    // docker exec CONFIG SET 이 겹치는 충돌이 생긴다.
    const multiMatch = JSON.stringify({
      containerName: "some-web",
      containerId: "abc123def456",
      mount: "/",
      usedPct: 92,
      evictionPolicy: "noeviction",
      maxMemBytes: 1073741824,
      target: "ais-prod",
    });
    const r = selectActions([ev({ detail: multiMatch })], new Map(), facts, NOW);
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0]).toMatchObject({ policyId: "restart-container" });
  });
});
