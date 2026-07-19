// /api/agent/metrics-ingest 라우트 통합 테스트 (memo-ingest 테스트 미러 — db mock).
// 검증: 401 · 400(malformed/스키마 불통) · 404(미등록 host) · 500(저장 실패) ·
//       200(inserted + 임계값 위반 record + 정상 resolve + 이벤트 실패 best-effort)
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

const insertSamplesMock = vi.hoisted(() => vi.fn());
const recordEventMock = vi.hoisted(() => vi.fn());
const resolveEventMock = vi.hoisted(() => vi.fn());
vi.mock("@/entities/monitoring/server", () => ({
  insertMetricSamples: insertSamplesMock,
  recordEvent: recordEventMock,
  resolveEvent: resolveEventMock,
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/agent/metrics-ingest/route";

function makeReq(bearer: string | null, body: BodyInit | null): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (bearer !== null) headers.set("Authorization", `Bearer ${bearer}`);
  return new Request("https://gons.krdn.kr/api/agent/metrics-ingest", {
    method: "POST",
    headers,
    body,
  });
}
const json = (o: unknown) => JSON.stringify(o);

function makeVitals(overrides: Record<string, unknown> = {}) {
  return {
    host: "home-server",
    cpuPct: 10,
    load1: 0.5,
    load5: 0.4,
    load15: 0.3,
    memUsedPct: 40,
    swapUsedMb: 100,
    disks: [{ mount: "/", usedPct: 50 }],
    uptimeSec: 3600,
    rebootRequired: false,
    ...overrides,
  };
}

describe("/api/agent/metrics-ingest", () => {
  beforeEach(() => {
    hostRow = [{ id: "h1" }];
    insertSamplesMock.mockReset().mockImplementation((rows: unknown[]) =>
      Promise.resolve(rows.length),
    );
    recordEventMock.mockReset().mockResolvedValue(undefined);
    resolveEventMock.mockReset().mockResolvedValue(undefined);
  });

  it("bearer 누락/오답 → 401", async () => {
    expect((await POST(makeReq(null, json(makeVitals())))).status).toBe(401);
    expect((await POST(makeReq("wrong", json(makeVitals())))).status).toBe(401);
    expect(insertSamplesMock).not.toHaveBeenCalled();
  });

  it("malformed JSON → 400", async () => {
    expect((await POST(makeReq(TEST_BEARER, "not-json{"))).status).toBe(400);
  });

  it("스키마 불통(cpuPct 누락) → 400", async () => {
    const body = makeVitals();
    delete (body as Record<string, unknown>).cpuPct;
    expect((await POST(makeReq(TEST_BEARER, json(body)))).status).toBe(400);
    expect(insertSamplesMock).not.toHaveBeenCalled();
  });

  it("미등록 host → 404", async () => {
    hostRow = [];
    const res = await POST(makeReq(TEST_BEARER, json(makeVitals())));
    expect(res.status).toBe(404);
  });

  it("샘플 저장 실패 → 500 + no-store", async () => {
    insertSamplesMock.mockRejectedValue(new Error("db down"));
    const res = await POST(makeReq(TEST_BEARER, json(makeVitals())));
    expect(res.status).toBe(500);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("정상 → 200 {inserted} + 정상 범위는 resolveEvent", async () => {
    const res = await POST(makeReq(TEST_BEARER, json(makeVitals())));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inserted).toBeGreaterThan(0);
    expect(recordEventMock).not.toHaveBeenCalled();
    // cpu/mem/disk:/​/reboot 전부 정상 → resolve 호출
    expect(resolveEventMock).toHaveBeenCalledWith("host:h1:cpu");
    expect(resolveEventMock).toHaveBeenCalledWith("host:h1:reboot");
  });

  it("cpu 98% → critical recordEvent (hostId·dedupKey 포함)", async () => {
    await POST(makeReq(TEST_BEARER, json(makeVitals({ cpuPct: 98 }))));
    expect(recordEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "host",
        severity: "critical",
        dedupKey: "host:h1:cpu",
        hostId: "h1",
      }),
    );
  });

  it("이벤트 기록 실패해도 200 (best-effort)", async () => {
    recordEventMock.mockRejectedValue(new Error("event db down"));
    const res = await POST(
      makeReq(TEST_BEARER, json(makeVitals({ cpuPct: 98 }))),
    );
    expect(res.status).toBe(200);
  });
});
