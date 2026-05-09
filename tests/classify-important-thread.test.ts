// classifyImportantThread orchestrator — DB upsert + 멱등성 + 메일링 컷.
// Anthropic은 mock, PG는 실제 (Testcontainers 없으면 로컬 DB) — 기존 테스트 인프라 그대로.
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

vi.mock("@/shared/lib/llm/anthropic", () => ({
  anthropic: { messages: { create: vi.fn() } },
  HAIKU_MODEL: "claude-haiku-4-5",
}));

import { db } from "@/shared/lib/db/client";
import {
  importantEmails,
  emailThreads,
  users,
} from "@/shared/lib/db/schema";
import { eq } from "drizzle-orm";
import { anthropic } from "@/shared/lib/llm/anthropic";
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

function mockLlm(obj: unknown): void {
  (anthropic.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    content: [{ type: "text", text: JSON.stringify(obj) }],
  });
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
  (anthropic.messages.create as ReturnType<typeof vi.fn>).mockReset();
  await db.delete(importantEmails).where(eq(importantEmails.threadId, threadId));
});

describe("classifyImportantThread", () => {
  it("정상 분류 → DB INSERT", async () => {
    mockLlm({
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
    expect(anthropic.messages.create).not.toHaveBeenCalled();
  });

  it("LLM none → skipped-none, DB 저장 X", async () => {
    mockLlm({
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
    mockLlm({
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
    expect(anthropic.messages.create).toHaveBeenCalledTimes(1);

    const rows = await db
      .select()
      .from(importantEmails)
      .where(eq(importantEmails.threadId, threadId));
    expect(rows).toHaveLength(1);
  });

  it("LLM 5xx → skipped-llm-error (사이클은 진행)", async () => {
    (anthropic.messages.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
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
