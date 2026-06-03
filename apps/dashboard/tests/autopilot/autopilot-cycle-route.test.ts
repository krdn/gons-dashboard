import { describe, it, expect, vi } from "vitest";

// recordCycle 을 mock — 라우트의 인증·검증 분기만 테스트. (Input 스키마는 실제 것 사용.)
// 라우트가 server barrel 에서 recordCycle + AutopilotCycleInput 둘 다 import 하므로
// 통째로 mock 하되 AutopilotCycleInput 은 진짜(model/inputSchema, 순수 Zod)를 노출.
// model 경로를 importActual 하는 이유: server barrel 의 진짜 recordCycle 은
// db(postgres) 체인을 끌어와 테스트 import 그래프를 오염시킨다.
vi.mock("@/entities/autopilot-cycle/server", async () => {
  const actual = await vi.importActual<
    typeof import("@/entities/autopilot-cycle/model/inputSchema")
  >("@/entities/autopilot-cycle/model/inputSchema");
  return {
    recordCycle: vi.fn().mockResolvedValue(undefined),
    AutopilotCycleInput: actual.AutopilotCycleInput,
  };
});

import { POST } from "@/app/api/cron/autopilot-cycle/route";

const TOKEN = process.env.CRON_BEARER_TOKEN ?? "test-token-test-token-test-token-1234";

function req(body: unknown, auth?: string) {
  return new Request("http://localhost/api/cron/autopilot-cycle", {
    method: "POST",
    headers: auth
      ? { authorization: auth, "content-type": "application/json" }
      : { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const valid = {
  id: "autopilot-2099-W02",
  date: "2099-01-12T00:00:00.000Z",
  mode: "shadow",
  candidateCount: 0,
  selected: null,
  reason: "no-candidate-selected",
  backlogTop3: [],
};

describe("POST /api/cron/autopilot-cycle", () => {
  it("Bearer 누락 시 401", async () => {
    const res = await POST(req(valid));
    expect(res.status).toBe(401);
  });

  it("잘못된 body 시 400", async () => {
    const res = await POST(req({ mode: "shadow" }, `Bearer ${TOKEN}`));
    expect(res.status).toBe(400);
  });

  it("정상 입력 시 200", async () => {
    const res = await POST(req(valid, `Bearer ${TOKEN}`));
    expect(res.status).toBe(200);
  });
});
