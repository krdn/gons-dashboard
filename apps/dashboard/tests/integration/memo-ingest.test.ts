// /api/agent/memo-ingest 라우트 통합 테스트.
// 검증: 401(bearer 누락/오답) · 400(malformed JSON·공백-only·20k 초과) ·
//       404(admin user 행 없음) · 500(createMemo 실패) · 200(id + no-store + after 예약)
const TEST_BEARER = vi.hoisted(() => {
  const token = "test-bearer-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // min 32자
  process.env.MCP_DASHBOARD_TOKEN = token;
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

let userRow: { id: string }[] = [];
vi.mock("@/shared/lib/db/client", () => {
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () => Promise.resolve(userRow),
  };
  return { db: { select: () => selectChain } };
});

const createMemoMock = vi.hoisted(() => vi.fn());
const classifyMock = vi.hoisted(() => vi.fn());
const extractMock = vi.hoisted(() => vi.fn());
const afterCallbacks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("@/entities/memo/server", () => ({
  createMemo: createMemoMock,
  classifyAndPersistMemoCategory: classifyMock,
}));
vi.mock("@/features/memo-actions", () => ({
  extractAndPersistMemoActions: extractMock,
}));
// client barrel은 UI 컴포넌트를 포함하므로 node 환경에서 mock으로 차단
// (createMemoAction.test.ts와 동일 관례). deriveTitle은 실제 규칙의 축약 복제 —
// 첫 문장 절단만 재현해 파생 경로를 결정적으로 검증한다.
vi.mock("@/entities/memo/client", () => ({
  deriveTitle: (s: string) => s.trim().split(/[.!?。\n]/)[0].trim() || "(제목 없음)",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({
  after: (cb: () => unknown) => afterCallbacks.push(cb),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/agent/memo-ingest/route";

function makeReq(bearer: string | null, body: BodyInit | null): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (bearer !== null) headers.set("Authorization", `Bearer ${bearer}`);
  return new Request("https://gons.krdn.kr/api/agent/memo-ingest", {
    method: "POST",
    headers,
    body,
  });
}
const json = (o: unknown) => JSON.stringify(o);

describe("/api/agent/memo-ingest", () => {
  beforeEach(() => {
    userRow = [{ id: "u1" }];
    createMemoMock.mockReset().mockResolvedValue({ id: "m1", category: null });
    classifyMock.mockReset().mockResolvedValue({ kind: "classified" });
    extractMock.mockReset().mockResolvedValue({ kind: "extracted", count: 0 });
    afterCallbacks.length = 0;
  });

  it("bearer 누락 → 401", async () => {
    const res = await POST(makeReq(null, json({ content: "본문" })));
    expect(res.status).toBe(401);
  });
  it("bearer 오답 → 401", async () => {
    const res = await POST(makeReq("wrong", json({ content: "본문" })));
    expect(res.status).toBe(401);
  });
  it("malformed JSON → 400", async () => {
    const res = await POST(makeReq(TEST_BEARER, "not-json{"));
    expect(res.status).toBe(400);
  });
  it("공백-only content → 400", async () => {
    const res = await POST(makeReq(TEST_BEARER, json({ content: "   " })));
    expect(res.status).toBe(400);
    expect(createMemoMock).not.toHaveBeenCalled();
  });
  it("20k 초과 content → 400", async () => {
    const res = await POST(makeReq(TEST_BEARER, json({ content: "a".repeat(20_001) })));
    expect(res.status).toBe(400);
  });
  it("admin user 행 없음 → 404", async () => {
    userRow = [];
    const res = await POST(makeReq(TEST_BEARER, json({ content: "본문" })));
    expect(res.status).toBe(404);
  });
  it("createMemo 실패 → 500", async () => {
    createMemoMock.mockRejectedValue(new Error("db down"));
    const res = await POST(makeReq(TEST_BEARER, json({ content: "본문" })));
    expect(res.status).toBe(500);
  });
  it("정상 → 200 {id} + no-store + trim 저장 + title 파생 + after 예약", async () => {
    const res = await POST(
      makeReq(TEST_BEARER, json({ content: "  다음 스프린트에 ingest 멱등 키 추가.  " })),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ id: "m1" });
    expect(createMemoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        source: "agent",
        rawContent: "다음 스프린트에 ingest 멱등 키 추가.",
        cleanedContent: "다음 스프린트에 ingest 멱등 키 추가.",
        title: "다음 스프린트에 ingest 멱등 키 추가",
      }),
    );
    expect(afterCallbacks.length).toBe(1);
    await afterCallbacks[0]();
    expect(classifyMock).toHaveBeenCalled();
    expect(extractMock).toHaveBeenCalled();
  });
  it("title 제공 시 trim해 그대로 사용", async () => {
    await POST(makeReq(TEST_BEARER, json({ title: "  제목  ", content: "본문" })));
    expect(createMemoMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "제목" }),
    );
  });
});
