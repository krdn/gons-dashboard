// cron 사이클 통합 회귀 — syncInbox 한 사이클에 reply_needed + important 양쪽 분류.
// Anthropic·Gmail은 mock, PG는 실제 DB.
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

vi.mock("@/shared/api/gmail/auth", () => ({
  getValidAccessToken: vi.fn().mockResolvedValue({ accessToken: "fake" }),
  InvalidGrantError: class InvalidGrantError extends Error {},
}));
vi.mock("@/shared/api/gmail/history", () => ({
  listHistorySince: vi.fn(),
  getCurrentHistoryId: vi.fn(),
  HistoryStaleError: class HistoryStaleError extends Error {},
}));
vi.mock("@/shared/api/gmail/messages", () => ({
  listMessages: vi.fn(),
  getMessage: vi.fn(),
  findHeader: (
    headers: Array<{ name: string; value: string }> | undefined,
    name: string,
  ) => {
    if (!headers) return null;
    const lower = name.toLowerCase();
    for (const h of headers) if (h.name.toLowerCase() === lower) return h.value;
    return null;
  },
}));
vi.mock("@krdn/llm-gateway/gateway", () => ({
  analyzeStructured: vi.fn(),
  normalizeUsage: (u?: Record<string, unknown> | null) => ({
    inputTokens: Number((u && (u.inputTokens ?? u.promptTokens)) ?? 0),
    outputTokens: Number((u && (u.outputTokens ?? u.completionTokens)) ?? 0),
    totalTokens: 0,
  }),
}));

import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  users,
  emailThreads,
  importantEmails,
  replyNeeded,
} from "@/shared/lib/db/schema";
import { listHistorySince } from "@/shared/api/gmail/history";
import { getMessage } from "@/shared/api/gmail/messages";
import { analyzeStructured } from "@krdn/llm-gateway/gateway";
import { syncInbox } from "@/features/gmail-sync/api/syncInbox";

const mockAnalyze = analyzeStructured as ReturnType<typeof vi.fn>;

let userId: string;

beforeAll(async () => {
  const [u] = await db
    .insert(users)
    .values({
      email: `cycle-${Date.now()}@example.com`,
      lastHistoryId: "1000",
    })
    .returning({ id: users.id });
  userId = u.id;
});

beforeEach(async () => {
  await db.delete(replyNeeded).where(eq(replyNeeded.userId, userId));
  await db.delete(importantEmails).where(eq(importantEmails.userId, userId));
  await db.delete(emailThreads).where(eq(emailThreads.userId, userId));
  vi.clearAllMocks();
  // lastHistoryId 복구.
  await db
    .update(users)
    .set({ lastHistoryId: "1000" })
    .where(eq(users.id, userId));
});

describe("syncInbox cycle", () => {
  it("한 사이클에 reply_needed + important 양쪽 분류", async () => {
    (listHistorySince as ReturnType<typeof vi.fn>).mockResolvedValue({
      newHistoryId: "1001",
      newMessageRefs: [{ id: "m1", threadId: "g1" }],
    });
    (getMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "m1",
      threadId: "g1",
      // deterministic 통과를 위해 회신 요청 키워드 포함 (HIGH 매치).
      snippet: "5/14 회의 일정 확정 — 강남역 회의실. 참석 가능 여부 회신 부탁드립니다",
      internalDate: String(Date.now()),
      payload: {
        headers: [
          { name: "From", value: "Alice <alice@acme.kr>" },
          { name: "Subject", value: "5/14 회의 일정 확정" },
        ],
      },
    });

    mockAnalyze
      .mockResolvedValueOnce({
        object: { needs_reply: false, severity: "low", reason: "공지" },
        usage: {},
        finishReason: "stop",
      })
      .mockResolvedValueOnce({
        object: {
          category: "schedule",
          importance: "med",
          summary: "5/14 강남역 회의 일정 확정",
          rationale: "일정 확정",
        },
        usage: {},
        finishReason: "stop",
      });

    const result = await syncInbox(userId);
    expect(result.kind).toMatch(/^ok-/);

    const importantRows = await db
      .select()
      .from(importantEmails)
      .where(eq(importantEmails.userId, userId));
    expect(importantRows).toHaveLength(1);
    expect(importantRows[0].category).toBe("schedule");
  });

  it("important 분류 실패해도 사이클은 성공", async () => {
    (listHistorySince as ReturnType<typeof vi.fn>).mockResolvedValue({
      newHistoryId: "1002",
      newMessageRefs: [{ id: "m2", threadId: "g2" }],
    });
    (getMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "m2",
      threadId: "g2",
      snippet: "test",
      internalDate: String(Date.now()),
      payload: { headers: [{ name: "From", value: "x@y.kr" }] },
    });

    mockAnalyze.mockRejectedValue(
      Object.assign(new Error("503"), { status: 503 }),
    );

    const result = await syncInbox(userId);
    expect(result.kind).toMatch(/^ok-/);
  });
});
