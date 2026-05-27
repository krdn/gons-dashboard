// reclassifyRecent — 수동 재분류 트리거.
//
// 검증 핵심:
//   1. 24h 윈도우 안의 스레드만 LLM 호출 (밖은 SQL gte 필터).
//   2. force=true면 important_emails 사전 삭제 후 재분류 → INSERT 다시 됨.
//   3. force=false면 기존 행 보전 → skipped-already.
//   4. user-not-found.
//
// Anthropic mock, PG는 실제 DB (다른 통합 테스트와 동일).
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

vi.mock("@krdn/llm-gateway/gateway", () => ({
  analyzeStructured: vi.fn(),
  normalizeUsage: vi.fn(),
}));

import { and, eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  users,
  emailThreads,
  importantEmails,
  replyNeeded,
} from "@/shared/lib/db/schema";
import { analyzeStructured } from "@krdn/llm-gateway/gateway";
import { reclassifyRecent } from "@/features/gmail-sync/api/reclassifyRecent";

const mockAnalyze = analyzeStructured as ReturnType<typeof vi.fn>;

let userId: string;
let recentThreadId: string;
let oldThreadId: string;

const RUN_PREFIX = `reclass-${Date.now()}`;

beforeAll(async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `${RUN_PREFIX}@example.com` })
    .returning({ id: users.id });
  userId = u.id;

  // 윈도우 안 (1시간 전).
  const [recent] = await db
    .insert(emailThreads)
    .values({
      userId,
      gmailThreadId: `${RUN_PREFIX}-recent`,
      subject: "급한 요청",
      lastSenderEmail: "client@example.com",
      lastSenderName: "Client",
      snippet: "내일까지 회신 부탁드립니다",
      lastReceivedAt: new Date(Date.now() - 60 * 60 * 1000),
    })
    .returning({ id: emailThreads.id });
  recentThreadId = recent.id;

  // 윈도우 밖 (48시간 전).
  const [old] = await db
    .insert(emailThreads)
    .values({
      userId,
      gmailThreadId: `${RUN_PREFIX}-old`,
      subject: "오래된 메일",
      lastSenderEmail: "old@example.com",
      snippet: "...",
      lastReceivedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    })
    .returning({ id: emailThreads.id });
  oldThreadId = old.id;
});

beforeEach(async () => {
  mockAnalyze.mockReset();
  await db.delete(importantEmails).where(eq(importantEmails.userId, userId));
  await db.delete(replyNeeded).where(eq(replyNeeded.userId, userId));
});

function mockLlmReplies(...objs: unknown[]): void {
  for (const obj of objs) {
    mockAnalyze.mockResolvedValueOnce({ object: obj, usage: {}, finishReason: "stop" });
  }
}

describe("reclassifyRecent", () => {
  it("user-not-found 반환", async () => {
    const result = await reclassifyRecent({
      userId: "00000000-0000-0000-0000-000000000000",
      hoursBack: 24,
      force: false,
    });
    expect(result.kind).toBe("user-not-found");
  });

  it("24h 윈도우 안 스레드만 처리 (밖은 SQL 단계에서 제외)", async () => {
    // classifyThread(reply) + classifyImportant 두 LLM 호출 / 윈도우 안 1개 스레드.
    mockLlmReplies(
      // classifyThread (reply_needed): no-reply
      { needs_reply: false, severity: "low", reason: "정보성" },
      // classifyImportant: none
      { category: "none", importance: "med", summary: "n/a", rationale: "" },
    );

    const result = await reclassifyRecent({
      userId,
      hoursBack: 24,
      force: false,
    });

    expect(result.kind).toBe("ok");
    expect(result.threadsInWindow).toBe(1); // recent만 카운트, old는 SQL에서 제외.
    expect(result.importantConsidered).toBe(1);
  });

  it("force=true — 기존 important_emails 삭제 후 재분류", async () => {
    // 1차 — 분류 시드.
    await db.insert(importantEmails).values({
      threadId: recentThreadId,
      userId,
      category: "money",
      importance: "high",
      summary: "stale",
      rationale: "stale",
      classifierVersion: "stale-v0",
      classifiedBy: "haiku",
      classifiedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2h ago
    });

    // 2차 — force 재분류. classifyThread + classifyImportant.
    mockLlmReplies(
      { needs_reply: false, severity: "low", reason: "정보성" },
      {
        category: "schedule",
        importance: "high",
        summary: "내일까지 회신",
        rationale: "회신 마감",
      },
    );

    const result = await reclassifyRecent({
      userId,
      hoursBack: 24,
      force: true,
    });

    expect(result.kind).toBe("ok");
    expect(result.forcedDeleted).toBe(1);
    expect(result.importantOutcomes?.classified).toBe(1);

    const [row] = await db
      .select()
      .from(importantEmails)
      .where(
        and(
          eq(importantEmails.userId, userId),
          eq(importantEmails.threadId, recentThreadId),
        ),
      );
    expect(row.category).toBe("schedule");
    expect(row.classifierVersion).not.toBe("stale-v0");
  });

  it("force=false — 이미 분류된 행은 보존, skipped-already로 집계", async () => {
    await db.insert(importantEmails).values({
      threadId: recentThreadId,
      userId,
      category: "money",
      importance: "high",
      summary: "preserved",
      rationale: "preserved",
      classifierVersion: "preserved-v0",
      classifiedBy: "haiku",
      // 미래의 last_received_at (1h ago)보다 늦은 시점 → idempotent skip 보장.
      classifiedAt: new Date(),
    });

    // classifyThread만 호출됨 (important는 skipped-already, LLM 미호출).
    mockLlmReplies({
      needs_reply: false,
      severity: "low",
      reason: "정보성",
    });

    const result = await reclassifyRecent({
      userId,
      hoursBack: 24,
      force: false,
    });

    expect(result.kind).toBe("ok");
    expect(result.forcedDeleted).toBe(0);
    expect(result.importantOutcomes?.["skipped-already"]).toBe(1);

    const [row] = await db
      .select()
      .from(importantEmails)
      .where(eq(importantEmails.threadId, recentThreadId));
    expect(row.classifierVersion).toBe("preserved-v0");
  });

  it("oldThreadId(48h 전)는 어떤 모드에서도 안 건드림", async () => {
    // recentThreadId 1개에 대해서만 LLM 모킹 — old가 처리되면 미모킹 호출로 throw가 발생함.
    mockLlmReplies(
      { needs_reply: false, severity: "low", reason: "정보성" },
      { category: "none", importance: "med", summary: "n/a", rationale: "" },
    );

    const result = await reclassifyRecent({
      userId,
      hoursBack: 24,
      force: true,
    });

    expect(result.threadsInWindow).toBe(1);
    expect(result.importantOutcomes?.["throw"]).toBeUndefined();

    const oldRow = await db
      .select()
      .from(importantEmails)
      .where(eq(importantEmails.threadId, oldThreadId));
    expect(oldRow).toHaveLength(0);
  });
});
