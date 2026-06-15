import { describe, it, expect, vi, afterEach } from "vitest";
import { buildRfc822, createDraft, type DraftParams } from "./drafts";

afterEach(() => vi.restoreAllMocks());

const base: DraftParams = {
  gmailThreadId: "t1",
  toEmail: "sender@example.com",
  subject: "회신 테스트",
  inReplyTo: "<msg-1@mail.gmail.com>",
  references: "<msg-0@mail.gmail.com> <msg-1@mail.gmail.com>",
  body: "안녕하세요, 답장 본문입니다.",
};

describe("buildRfc822", () => {
  it("Subject가 Re: 접두 + 원본 일치", () => {
    const raw = buildRfc822(base);
    expect(raw).toMatch(/Subject: .*(Re:|=\?UTF-8)/);
  });

  it("In-Reply-To / References 헤더 포함", () => {
    const raw = buildRfc822(base);
    expect(raw).toContain("In-Reply-To: <msg-1@mail.gmail.com>");
    expect(raw).toContain("References: <msg-0@mail.gmail.com> <msg-1@mail.gmail.com>");
  });

  it("한글 body → UTF-8 charset 헤더", () => {
    const raw = buildRfc822(base);
    expect(raw).toMatch(/Content-Type: text\/plain; charset="?UTF-8"?/i);
  });

  it("한글 Subject → MIME encoded-word(=?UTF-8?B?)", () => {
    const raw = buildRfc822({ ...base, subject: "한글 제목" });
    expect(raw).toContain("=?UTF-8?B?");
  });
});

describe("createDraft", () => {
  it("drafts.create에 threadId 포함한 message 전송", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "draft1", message: { id: "m2" } }), { status: 200 }),
    );
    const result = await createDraft("token123", base);
    expect(result.draftId).toBe("draft1");
    const callBody = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(callBody.message.threadId).toBe("t1");
    expect(typeof callBody.message.raw).toBe("string");
  });
});
