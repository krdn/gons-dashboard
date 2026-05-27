// classifyImportantThread orchestrator — DB upsert + 멱등성 + 메일링 컷.
// llm-gateway mock, PG는 실제 DB.
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

vi.mock("@krdn/llm-gateway/gateway", () => ({
  analyzeStructured: vi.fn(),
  normalizeUsage: vi.fn(),
}));

import { db } from "@/shared/lib/db/client";
import {
  importantEmails,
  emailThreads,
  users,
} from "@/shared/lib/db/schema";
import { eq } from "drizzle-orm";
import { analyzeStructured } from "@krdn/llm-gateway/gateway";
import { classifyImportantThread } from "@/entities/email/api/classifyImportant";
import type {
  ImportantInput,
} from "@/entities/email/model/types";
import type { MailingListSignals } from "@/shared/api/gmail";

const cleanSignals: MailingListSignals = {
  hasListUnsubscribe: false,
  hasListId: false,
  precedence: null,
  fromHeader: "Naver Pay <noreply@pay.naver.com>",
};

const mailingSignals: MailingListSignals = {
  ...cleanSignals,
  hasListUnsubscribe: true,
};

const baseInput: ImportantInput = {
  subject: "결제 완료",
  fromName: "Naver Pay",
  fromEmail: "noreply@pay.naver.com",
  snippet: "스타벅스 27,500원 결제",
  receivedAtKst: "2026-05-09 14:30 KST",
};

const mockAnalyze = analyzeStructured as ReturnType<typeof vi.fn>;

function mockGateway(obj: unknown): void {
  mockAnalyze.mockResolvedValueOnce({ object: obj, usage: {}, finishReason: "stop" });
}

let userId: string;
let threadId: string;

beforeAll(async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `test-${Date.now()}@example.com` })
    .returning({ id: users.id });
  userId = u.id;

  const [t] = await db
    .insert(emailThreads)
    .values({
      userId,
      gmailThreadId: `gmail-${Date.now()}`,
      subject: "결제 완료",
      lastSenderEmail: "noreply@pay.naver.com",
      lastReceivedAt: new Date(),
      snippet: "스타벅스 27,500원 결제",
    })
    .returning({ id: emailThreads.id });
  threadId = t.id;
});

beforeEach(async () => {
  mockAnalyze.mockReset();
  await db.delete(importantEmails).where(eq(importantEmails.threadId, threadId));
});

describe("classifyImportantThread", () => {
  it("정상 분류 → DB INSERT", async () => {
    mockGateway({
      category: "money",
      importance: "high",
      summary: "스타벅스 27,500원 결제",
      rationale: "...",
    });

    const outcome = await classifyImportantThread({
      userId,
      threadId,
      input: baseInput,
      signals: cleanSignals,
    });

    expect(outcome.kind).toBe("classified");

    const rows = await db
      .select()
      .from(importantEmails)
      .where(eq(importantEmails.threadId, threadId));
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("money");
    expect(rows[0].importance).toBe("high");
    expect(rows[0].classifierVersion).toContain("haiku-important");
  });

  it("메일링 시그널 → LLM 호출 안 함, skipped-mailing-list", async () => {
    const outcome = await classifyImportantThread({
      userId,
      threadId,
      input: baseInput,
      signals: mailingSignals,
    });
    expect(outcome.kind).toBe("skipped-mailing-list");
    expect(mockAnalyze).not.toHaveBeenCalled();
  });

  it("LLM none → skipped-none, DB 저장 X", async () => {
    mockGateway({
      category: "none",
      importance: "med",
      summary: "마케팅",
      rationale: "",
    });
    const outcome = await classifyImportantThread({
      userId,
      threadId,
      input: baseInput,
      signals: cleanSignals,
    });
    expect(outcome.kind).toBe("skipped-none");
    const rows = await db
      .select()
      .from(importantEmails)
      .where(eq(importantEmails.threadId, threadId));
    expect(rows).toHaveLength(0);
  });

  it("멱등 — 같은 입력 두 번 호출, INSERT 1회", async () => {
    mockGateway({
      category: "money",
      importance: "high",
      summary: "스타벅스 결제",
      rationale: "...",
    });
    await classifyImportantThread({
      userId,
      threadId,
      input: baseInput,
      signals: cleanSignals,
    });

    const outcome = await classifyImportantThread({
      userId,
      threadId,
      input: baseInput,
      signals: cleanSignals,
    });
    expect(outcome.kind).toBe("skipped-already");
    expect(mockAnalyze).toHaveBeenCalledTimes(1);

    const rows = await db
      .select()
      .from(importantEmails)
      .where(eq(importantEmails.threadId, threadId));
    expect(rows).toHaveLength(1);
  });

  it("LLM 5xx → skipped-llm-error (사이클은 진행)", async () => {
    mockAnalyze.mockRejectedValueOnce(
      Object.assign(new Error("503"), { status: 503 }),
    );
    const outcome = await classifyImportantThread({
      userId,
      threadId,
      input: baseInput,
      signals: cleanSignals,
    });
    expect(outcome.kind).toBe("skipped-llm-error");
  });
});
