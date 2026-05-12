import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

vi.mock("@/shared/lib/auth", () => ({
  auth: vi.fn(),
}));
vi.mock("@/shared/api/gmail/auth", () => ({
  getValidAccessToken: vi.fn().mockResolvedValue({ accessToken: "fake-token" }),
}));
vi.mock("@/shared/api/gmail/modify", () => ({
  modifyThread: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  users,
  emailThreads,
  importantEmails,
} from "@/shared/lib/db/schema";
import { auth } from "@/shared/lib/auth";
import { modifyThread } from "@/shared/api/gmail/modify";
import { markAsRead } from "@/features/email-analysis/api/markAsRead";
import { archiveThread } from "@/features/email-analysis/api/archiveThread";
import {
  GmailError,
  GmailRateLimitError,
  InvalidGrantError,
} from "@/shared/api/gmail";

let userId: string;
let otherUserId: string;
let threadId: string;
let otherThreadId: string;

beforeAll(async () => {
  const [u1] = await db
    .insert(users)
    .values({ email: `act-${Date.now()}-a@example.com` })
    .returning({ id: users.id });
  userId = u1.id;
  const [u2] = await db
    .insert(users)
    .values({ email: `act-${Date.now()}-b@example.com` })
    .returning({ id: users.id });
  otherUserId = u2.id;

  const [t1] = await db
    .insert(emailThreads)
    .values({
      userId,
      gmailThreadId: `gm-act-${Date.now()}`,
      lastReceivedAt: new Date(),
    })
    .returning({ id: emailThreads.id });
  threadId = t1.id;

  const [t2] = await db
    .insert(emailThreads)
    .values({
      userId: otherUserId,
      gmailThreadId: `gm-other-${Date.now()}`,
      lastReceivedAt: new Date(),
    })
    .returning({ id: emailThreads.id });
  otherThreadId = t2.id;
});

beforeEach(async () => {
  await db.delete(importantEmails).where(eq(importantEmails.userId, userId));
  await db
    .delete(importantEmails)
    .where(eq(importantEmails.userId, otherUserId));
  (auth as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { id: userId },
  });
  (modifyThread as ReturnType<typeof vi.fn>).mockReset();
  (modifyThread as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "msg",
    threadId: "thr",
  });

  await db.insert(importantEmails).values({
    threadId,
    userId,
    category: "money",
    importance: "high",
    summary: "summary",
    rationale: "r",
    classifierVersion: "v1.0-haiku-important-2026-05",
    classifiedBy: "llm-haiku",
    classifiedAt: new Date(),
  });
});

describe("markAsRead", () => {
  it("정상 — Gmail 호출 후 DB read_at SET", async () => {
    const result = await markAsRead(threadId);
    expect(result).toEqual({ ok: true });
    expect(modifyThread).toHaveBeenCalledWith(
      "fake-token",
      expect.any(String),
      { removeLabelIds: ["UNREAD"] },
    );
    const [row] = await db
      .select()
      .from(importantEmails)
      .where(eq(importantEmails.threadId, threadId));
    expect(row.readAt).toBeInstanceOf(Date);
  });

  it("Gmail 5xx 실패 → DB 미변경", async () => {
    (modifyThread as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new GmailError("server-error", 503, "down"),
    );
    const result = await markAsRead(threadId);
    expect(result.ok).toBe(false);
    const [row] = await db
      .select()
      .from(importantEmails)
      .where(eq(importantEmails.threadId, threadId));
    expect(row.readAt).toBeNull();
  });

  it("다른 사용자의 threadId — not-found", async () => {
    const result = await markAsRead(otherThreadId);
    expect(result).toEqual({ ok: false, reason: "not-found" });
    expect(modifyThread).not.toHaveBeenCalled();
  });

  it("로그인 안 된 상태 — unauthorized", async () => {
    (auth as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const result = await markAsRead(threadId);
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("InvalidGrantError → reason='reauth-required'", async () => {
    (modifyThread as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new InvalidGrantError("refresh token revoked"),
    );
    const result = await markAsRead(threadId);
    expect(result).toEqual({ ok: false, reason: "reauth-required" });
  });

  it("GmailRateLimitError → reason='rate-limited'", async () => {
    (modifyThread as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new GmailRateLimitError("quota exceeded"),
    );
    const result = await markAsRead(threadId);
    expect(result).toEqual({ ok: false, reason: "rate-limited" });
  });

  it("Gmail 401 → reason='unauthorized'", async () => {
    (modifyThread as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new GmailError("token expired", 401),
    );
    const result = await markAsRead(threadId);
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("Gmail 403 → reason='forbidden'", async () => {
    (modifyThread as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new GmailError("insufficient scope", 403, "forbidden"),
    );
    const result = await markAsRead(threadId);
    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });
});

describe("archiveThread", () => {
  it("정상 — Gmail INBOX 제거 후 archived_at SET", async () => {
    const result = await archiveThread(threadId);
    expect(result).toEqual({ ok: true });
    expect(modifyThread).toHaveBeenCalledWith(
      "fake-token",
      expect.any(String),
      { removeLabelIds: ["INBOX"] },
    );
    const [row] = await db
      .select()
      .from(importantEmails)
      .where(eq(importantEmails.threadId, threadId));
    expect(row.archivedAt).toBeInstanceOf(Date);
  });

  it("404 (Gmail 메시지 사라짐) → archived_at SET (정리)", async () => {
    (modifyThread as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new GmailError("client-error", 404, "not found"),
    );
    const result = await archiveThread(threadId);
    expect(result).toEqual({ ok: true });
    const [row] = await db
      .select()
      .from(importantEmails)
      .where(eq(importantEmails.threadId, threadId));
    expect(row.archivedAt).toBeInstanceOf(Date);
  });

  it("InvalidGrantError → reason='reauth-required'", async () => {
    (modifyThread as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new InvalidGrantError("refresh token revoked"),
    );
    const result = await archiveThread(threadId);
    expect(result).toEqual({ ok: false, reason: "reauth-required" });
  });

  it("GmailRateLimitError → reason='rate-limited'", async () => {
    (modifyThread as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new GmailRateLimitError("quota exceeded"),
    );
    const result = await archiveThread(threadId);
    expect(result).toEqual({ ok: false, reason: "rate-limited" });
  });
});
