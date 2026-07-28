import { describe, it, expect, vi } from "vitest";

// runRemediationCycle 을 mock — 라우트의 인증·envelope 셰이프만 테스트한다.
// 진짜 사이클(db 체인 + selectActions + executeAction)은 features/monitoring-remediate
// 자체 유닛 테스트(remediationGuards, remediationPolicies, selectActions)가 담당.
vi.mock("@/features/monitoring-remediate", () => ({
  runRemediationCycle: vi.fn().mockResolvedValue({
    planned: 1,
    executed: 1,
    skipped: 0,
    failed: 0,
    dryRun: true,
  }),
}));

import { runRemediationCycle } from "@/features/monitoring-remediate";
import { POST } from "@/app/api/cron/auto-remediate/route";

const TOKEN = process.env.CRON_BEARER_TOKEN ?? "test-token-test-token-test-token-1234";

function req(auth?: string) {
  return new Request("http://localhost/api/cron/auto-remediate", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });
}

describe("POST /api/cron/auto-remediate", () => {
  it("Bearer 누락 시 401 — runRemediationCycle 미호출", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(runRemediationCycle).not.toHaveBeenCalled();
  });

  it("정상 Bearer 시 200 + runRemediationCycle 1회 호출", async () => {
    const res = await POST(req(`Bearer ${TOKEN}`));
    expect(res.status).toBe(200);
    expect(runRemediationCycle).toHaveBeenCalledTimes(1);
    expect(runRemediationCycle).toHaveBeenCalledWith(expect.any(Date));

    const body = await res.json();
    expect(body.name).toBe("auto-remediate");
    expect(body.total).toBe(1);
    expect(body.succeeded).toBe(1);
    expect(body.results[0]).toMatchObject({
      id: "cycle",
      status: "ok",
      payload: { planned: 1, executed: 1, skipped: 0, failed: 0, dryRun: true },
    });
  });
});
