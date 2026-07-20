// /api/agent/checks-ingest 라우트 통합 테스트 (metrics-ingest 테스트 미러 — db mock).
// 검증: 401 · 400 · 404 · 200(판정→check_results insert + 이벤트 record/resolve/무발행)
const TEST_BEARER = vi.hoisted(() => {
  const token = "test-metrics-token-aaaaaaaaaaaaaaaaaaaaaaaaaa"; // min 32자
  process.env.METRICS_INGEST_TOKEN = token;
  process.env.MCP_DASHBOARD_TOKEN ??= "test-bearer-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  process.env.ADMIN_EMAILS ??= "krdn.net@gmail.com";
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5999/test_dummy";
  process.env.REDIS_URL ??= "redis://localhost:6379";
  process.env.NEXTAUTH_SECRET ??= "test-secret-at-least-32-chars-padded!!";
  process.env.NEXTAUTH_URL ??= "http://localhost:3020";
  process.env.GOOGLE_CLIENT_ID ??= "test-google-client-id";
  process.env.GOOGLE_CLIENT_SECRET ??= "test-google-client-secret";
  process.env.ANTHROPIC_BASE_URL ??= "http://localhost:8317";
  process.env.ANTHROPIC_API_KEY ??= "test-anthropic-key";
  process.env.CRON_BEARER_TOKEN ??= "test-cron-bearer-token-padded-aaaaaaaaaa";
  process.env.ALLOWLIST_EMAILS ??= "krdn.net@gmail.com";
  return token;
});

let hostRow: { id: string }[] = [];
vi.mock("@/shared/lib/db/client", () => {
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () => Promise.resolve(hostRow),
  };
  return { db: { select: () => selectChain } };
});

const insertChecksMock = vi.hoisted(() => vi.fn());
const insertSamplesMock = vi.hoisted(() => vi.fn());
const recordEventMock = vi.hoisted(() => vi.fn());
const resolveEventMock = vi.hoisted(() => vi.fn());
vi.mock("@/entities/monitoring/server", () => ({
  insertCheckResults: insertChecksMock,
  insertMetricSamples: insertSamplesMock,
  recordEvent: recordEventMock,
  resolveEvent: resolveEventMock,
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/agent/checks-ingest/route";
import { DATASTORE_INSTANCES } from "@/features/monitoring-datastore";

function makeReq(bearer: string | null, body: BodyInit | null): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (bearer !== null) headers.set("Authorization", `Bearer ${bearer}`);
  return new Request("https://gons.krdn.kr/api/agent/checks-ingest", {
    method: "POST",
    headers,
    body,
  });
}
const json = (o: unknown) => JSON.stringify(o);

describe("/api/agent/checks-ingest", () => {
  beforeEach(() => {
    hostRow = [{ id: "h1" }];
    insertChecksMock.mockReset().mockImplementation((rows: unknown[]) =>
      Promise.resolve(rows.length),
    );
    recordEventMock.mockReset().mockResolvedValue(undefined);
    resolveEventMock.mockReset().mockResolvedValue(undefined);
  });

  it("bearer 누락/오답 → 401", async () => {
    const body = json({ host: "home-server" });
    expect((await POST(makeReq(null, body))).status).toBe(401);
    expect((await POST(makeReq("wrong", body))).status).toBe(401);
  });

  it("malformed JSON / 스키마 불통 → 400", async () => {
    expect((await POST(makeReq(TEST_BEARER, "not-json{"))).status).toBe(400);
    expect(
      (
        await POST(
          makeReq(TEST_BEARER, json({ host: "h", services: [{ unit: "" }] })),
        )
      ).status,
    ).toBe(400);
  });

  it("미등록 host → 404", async () => {
    hostRow = [];
    const res = await POST(makeReq(TEST_BEARER, json({ host: "ghost" })));
    expect(res.status).toBe(404);
  });

  it("정상 → 200 {inserted} + failed 서비스는 critical record, active 는 resolve", async () => {
    const res = await POST(
      makeReq(
        TEST_BEARER,
        json({
          host: "home-server",
          services: [
            { unit: "nginx", active: "active" },
            { unit: "ollama", active: "failed" },
          ],
        }),
      ),
    );
    expect(res.status).toBe(200);
    // 서비스 2 + 보안 5 + 데이터스토어 전량. Phase 3 부터 섹션이 없어도 판정을
    // 건너뛰지 않는다 — verdict 가 없으면 새 행이 안 생겨 보드에 직전 상태가
    // 남기 때문(관측 공백이 정상으로 보이는 미탐). 데이터스토어 개수는
    // instances.ts 에서 파생시킨다(하드코딩하면 목록 변경 시 조용히 어긋난다).
    // Phase 4 부터 심층지표(datastoreStats)도 항상 verdict 를 낸다 — 같은 이유
    // (행이 안 생기면 보드에 직전 상태가 남는다). 개수는 instances.ts 에서 파생.
    expect((await res.json()).inserted).toBe(
      2 + 5 + DATASTORE_INSTANCES.length * 2,
    );
    expect(recordEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "service",
        severity: "critical",
        dedupKey: "host:h1:svc:ollama",
        hostId: "h1",
      }),
    );
    expect(resolveEventMock).toHaveBeenCalledWith("host:h1:svc:nginx");
  });

  it("빈 payload 에도 보안 5종 + 데이터스토어 전량 unknown 행을 남긴다 (stale 방지)", async () => {
    // collector 미설치·산출물 노후로 에이전트가 섹션을 생략했을 때,
    // 판정까지 건너뛰면 check_results 에 새 행이 안 생겨 보드가 직전 상태
    // (ok 또는 critical)를 계속 표시한다.
    const res = await POST(
      makeReq(TEST_BEARER, json({ host: "home-server" })),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).inserted).toBe(5 + DATASTORE_INSTANCES.length * 2);
    // unknown 이므로 이벤트는 발행하지 않는다 (위반도 정상 복귀도 아님).
    expect(recordEventMock).not.toHaveBeenCalled();
  });

  it("unknown 판정(readable=false)은 record/resolve 무발행", async () => {
    await POST(
      makeReq(
        TEST_BEARER,
        json({
          host: "home-server",
          hostCron: [{ name: "x", readable: false, maxAgeMin: 60 }],
        }),
      ),
    );
    expect(recordEventMock).not.toHaveBeenCalled();
    expect(resolveEventMock).not.toHaveBeenCalled();
  });

  it("이벤트 기록 실패해도 200 (best-effort)", async () => {
    recordEventMock.mockRejectedValue(new Error("event db down"));
    const res = await POST(
      makeReq(
        TEST_BEARER,
        json({
          host: "home-server",
          services: [{ unit: "ollama", active: "failed" }],
        }),
      ),
    );
    expect(res.status).toBe(200);
  });
});
