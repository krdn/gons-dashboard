// D6 답장 우선 정책 핵심 검증 — 활성 reply_needed 있는 스레드는 important에서 숨김.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  users,
  emailThreads,
  importantEmails,
  replyNeeded,
} from "@/shared/lib/db/schema";
import { getImportantEmails } from "@/entities/email/api/getImportantEmails";

let userId: string;

async function seedThread(opts: {
  gmailThreadId: string;
  receivedAt: Date;
  subject?: string;
}): Promise<string> {
  const [t] = await db
    .insert(emailThreads)
    .values({
      userId,
      gmailThreadId: opts.gmailThreadId,
      subject: opts.subject ?? "Test",
      lastSenderEmail: "alice@acme.kr",
      lastSenderName: "Alice",
      lastReceivedAt: opts.receivedAt,
      snippet: "snippet",
    })
    .returning({ id: emailThreads.id });
  return t.id;
}

async function seedImportant(opts: {
  threadId: string;
  importance: "high" | "med";
  classifiedAt: Date;
  category?: "money" | "security" | "schedule" | "notice";
}): Promise<void> {
  await db.insert(importantEmails).values({
    threadId: opts.threadId,
    userId,
    category: opts.category ?? "money",
    importance: opts.importance,
    summary: "summary",
    rationale: "rationale",
    classifierVersion: "v1.0-haiku-important-2026-05",
    classifiedBy: "llm-haiku",
    classifiedAt: opts.classifiedAt,
  });
}

async function seedReplyNeeded(opts: {
  threadId: string;
  repliedAt?: Date | null;
  dismissedAt?: Date | null;
}): Promise<void> {
  await db.insert(replyNeeded).values({
    threadId: opts.threadId,
    userId,
    reason: "회신 요청",
    severity: "high",
    classifierVersion: "v1.0-haiku-2026-05",
    classifiedBy: "llm-haiku",
    classifiedAt: new Date(),
    userAction: "none",
    repliedAt: opts.repliedAt ?? null,
    dismissedAt: opts.dismissedAt ?? null,
  });
}

beforeAll(async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `test-imp-${Date.now()}@example.com` })
    .returning({ id: users.id });
  userId = u.id;
});

beforeEach(async () => {
  await db.delete(replyNeeded).where(eq(replyNeeded.userId, userId));
  await db.delete(importantEmails).where(eq(importantEmails.userId, userId));
  await db.delete(emailThreads).where(eq(emailThreads.userId, userId));
});

describe("getImportantEmails", () => {
  it("기본 — 활성 important 행 반환", async () => {
    const t = await seedThread({
      gmailThreadId: "gt1",
      receivedAt: new Date(),
    });
    await seedImportant({ threadId: t, importance: "high", classifiedAt: new Date() });
    const result = await getImportantEmails(userId, 10);
    expect(result).toHaveLength(1);
    expect(result[0].importance).toBe("high");
  });

  it("D6 — 활성 reply_needed 있는 스레드는 숨김", async () => {
    const t = await seedThread({
      gmailThreadId: "gt2",
      receivedAt: new Date(),
    });
    await seedImportant({ threadId: t, importance: "high", classifiedAt: new Date() });
    await seedReplyNeeded({ threadId: t });

    expect(await getImportantEmails(userId, 10)).toHaveLength(0);
  });

  it("D6 — reply_needed.repliedAt SET 후 important에 등장", async () => {
    const t = await seedThread({
      gmailThreadId: "gt3",
      receivedAt: new Date(),
    });
    await seedImportant({ threadId: t, importance: "high", classifiedAt: new Date() });
    await seedReplyNeeded({ threadId: t, repliedAt: new Date() });

    expect(await getImportantEmails(userId, 10)).toHaveLength(1);
  });

  it("D6 — reply_needed.dismissedAt SET 후 important에 등장", async () => {
    const t = await seedThread({
      gmailThreadId: "gt4",
      receivedAt: new Date(),
    });
    await seedImportant({ threadId: t, importance: "high", classifiedAt: new Date() });
    await seedReplyNeeded({ threadId: t, dismissedAt: new Date() });

    expect(await getImportantEmails(userId, 10)).toHaveLength(1);
  });

  it("read_at·archived_at SET 행은 제외", async () => {
    const t1 = await seedThread({ gmailThreadId: "gt5", receivedAt: new Date() });
    await seedImportant({
      threadId: t1,
      importance: "high",
      classifiedAt: new Date(),
    });
    await db
      .update(importantEmails)
      .set({ readAt: new Date() })
      .where(eq(importantEmails.threadId, t1));

    const t2 = await seedThread({ gmailThreadId: "gt6", receivedAt: new Date() });
    await seedImportant({
      threadId: t2,
      importance: "high",
      classifiedAt: new Date(),
    });
    await db
      .update(importantEmails)
      .set({ archivedAt: new Date() })
      .where(eq(importantEmails.threadId, t2));

    expect(await getImportantEmails(userId, 10)).toHaveLength(0);
  });

  it("7일 윈도 — 8일 전 분류 행 제외", async () => {
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    const t1 = await seedThread({ gmailThreadId: "gt7", receivedAt: old });
    await seedImportant({ threadId: t1, importance: "high", classifiedAt: old });

    const t2 = await seedThread({ gmailThreadId: "gt8", receivedAt: recent });
    await seedImportant({ threadId: t2, importance: "high", classifiedAt: recent });

    const result = await getImportantEmails(userId, 10);
    expect(result).toHaveLength(1);
    expect(result[0].gmailThreadId).toBe("gt8");
  });

  it("정렬 — high 먼저, 같은 importance면 classified_at DESC", async () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    const t1 = await seedThread({ gmailThreadId: "gtA", receivedAt: now });
    await seedImportant({ threadId: t1, importance: "med", classifiedAt: now });

    const t2 = await seedThread({ gmailThreadId: "gtB", receivedAt: now });
    await seedImportant({ threadId: t2, importance: "high", classifiedAt: oneHourAgo });

    const t3 = await seedThread({ gmailThreadId: "gtC", receivedAt: now });
    await seedImportant({ threadId: t3, importance: "high", classifiedAt: now });

    const result = await getImportantEmails(userId, 10);
    expect(result.map((r) => r.gmailThreadId)).toEqual(["gtC", "gtB", "gtA"]);
  });

  it("limit 10 — TOP 10만", async () => {
    for (let i = 0; i < 12; i++) {
      const t = await seedThread({
        gmailThreadId: `gt-bulk-${i}`,
        receivedAt: new Date(Date.now() - i * 1000),
      });
      await seedImportant({
        threadId: t,
        importance: "high",
        classifiedAt: new Date(Date.now() - i * 1000),
      });
    }
    const result = await getImportantEmails(userId, 10);
    expect(result).toHaveLength(10);
  });
});
