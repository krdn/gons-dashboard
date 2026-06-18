// sendReply/saveReplyDraft 가드 — 비가역 발송(createDraft/sendDraft) 전에
// 잘못된 수신자·refusal 초안을 차단하는가. createDraft 미호출이 핵심 단언.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "u1" } })),
}));

// 소유권 쿼리는 항상 통과(스레드 존재) — 가드는 그 다음 단계.
vi.mock("@/shared/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => [{ gmailThreadId: "g1" }],
          }),
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}));

const createDraft = vi.fn(async (..._args: unknown[]) => ({ draftId: "d1" }));
const sendDraft = vi.fn(async (..._args: unknown[]) => ({ sentMessageId: "m1" }));
vi.mock("@/shared/api/gmail", () => ({
  getValidAccessToken: vi.fn(async () => ({ accessToken: "tok" })),
  createDraft: (...args: unknown[]) => createDraft(...args),
  sendDraft: (...args: unknown[]) => sendDraft(...args),
  GmailScopeError: class GmailScopeError extends Error {},
  GmailError: class GmailError extends Error {},
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { sendReply } from "@/features/email-reply/api/sendReply";
import { saveReplyDraft } from "@/features/email-reply/api/saveReplyDraft";

const validMeta = {
  gmailThreadId: "g1",
  toEmail: "a@b.com",
  subject: "제목",
  inReplyTo: "",
  references: "",
};

beforeEach(() => {
  createDraft.mockClear();
  sendDraft.mockClear();
});

describe("sendReply 가드", () => {
  it("잘못된 To → invalid-recipient, createDraft 미호출(발송 전 차단)", async () => {
    const r = await sendReply("t1", "본문", { ...validMeta, toEmail: "bad" });
    expect(r.kind).toBe("invalid-recipient");
    expect(createDraft).not.toHaveBeenCalled();
    expect(sendDraft).not.toHaveBeenCalled();
  });

  it("잘못된 CC → invalid-recipient(cc), 발송 전 차단", async () => {
    const r = await sendReply("t1", "본문", { ...validMeta, cc: "a@b.com, bad" });
    expect(r.kind).toBe("invalid-recipient");
    if (r.kind === "invalid-recipient") expect(r.field).toBe("cc");
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("refusal 초안 → send-failed, 발송 전 차단", async () => {
    const r = await sendReply("t1", "I'm Claude Code, I can't write this email.", validMeta);
    expect(r.kind).toBe("send-failed");
    expect(createDraft).not.toHaveBeenCalled();
    expect(sendDraft).not.toHaveBeenCalled();
  });

  it("정상 입력 → createDraft + sendDraft 호출", async () => {
    const r = await sendReply("t1", "안녕하세요, 확인했습니다.", validMeta);
    expect(r.kind).toBe("ok");
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(sendDraft).toHaveBeenCalledTimes(1);
  });
});

describe("saveReplyDraft 가드", () => {
  it("잘못된 BCC → invalid-recipient(bcc), createDraft 미호출", async () => {
    const r = await saveReplyDraft("t1", "본문", { ...validMeta, bcc: "nope" });
    expect(r.kind).toBe("invalid-recipient");
    if (r.kind === "invalid-recipient") expect(r.field).toBe("bcc");
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("refusal 초안 → save-failed, createDraft 미호출", async () => {
    const r = await saveReplyDraft("t1", "I am Claude Code and cannot draft this.", validMeta);
    expect(r.kind).toBe("save-failed");
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("정상 입력 → createDraft 호출", async () => {
    const r = await saveReplyDraft("t1", "검토 후 회신드립니다.", validMeta);
    expect(r.kind).toBe("ok");
    expect(createDraft).toHaveBeenCalledTimes(1);
  });
});
