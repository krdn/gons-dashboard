import { describe, it, expect } from "vitest";
import { remediationTarget } from "@/widgets/monitoring/lib/remediationTarget";

// detail 은 runCycle 이 저장한 JSON.stringify(RemediationAction) 이다.
describe("remediationTarget", () => {
  it("restart-container: 컨테이너 이름 + 짧은 id", () => {
    const detail = JSON.stringify({
      kind: "restart-container",
      hostId: "h1",
      containerId: "abc123def456",
      containerName: "gons-cron",
    });
    expect(remediationTarget(detail)).toBe("gons-cron (abc123def456)");
  });

  it("raise-redis-maxmemory: target + 상향 값", () => {
    const detail = JSON.stringify({
      kind: "raise-redis-maxmemory",
      hostId: "h1",
      target: "ais-prod",
      nextBytes: 2 * 1024 ** 3,
    });
    expect(remediationTarget(detail)).toBe("ais-prod → 2.0GiB");
  });

  it("prune-images: 사람이 읽을 식별자가 없으면 null (보드는 dedupKey 로 보완)", () => {
    const detail = JSON.stringify({ kind: "prune-images", hostId: "h1" });
    expect(remediationTarget(detail)).toBeNull();
  });

  it("detail 이 null 이면 null (skip 행)", () => {
    expect(remediationTarget(null)).toBeNull();
  });

  it("detail 이 JSON 이 아니면 null", () => {
    expect(remediationTarget("not json")).toBeNull();
  });
});
