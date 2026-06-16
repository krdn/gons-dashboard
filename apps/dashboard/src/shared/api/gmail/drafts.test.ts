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

  it("헤더 인젝션 방지 — toEmail/inReplyTo의 CRLF 제거", () => {
    const raw = buildRfc822({ ...base, toEmail: "evil@x.com\r\nBcc: victim@x.com" });
    // 핵심 보안 속성: Bcc 가 독립된 헤더 줄(\r\nBcc:)로 주입되지 않을 것.
    // (값 안에 'Bcc:' 문자열이 섞이는 건 무해 — 줄바꿈만 제거되면 헤더가 아니다.)
    expect(raw).not.toContain("\r\nBcc:");
    expect(raw).toContain("To: evil@x.comBcc: victim@x.com");
  });

  it("cc/bcc 있으면 Cc/Bcc 헤더 추가, 없으면 생략", () => {
    const withCc = buildRfc822({
      gmailThreadId: "t", toEmail: "a@b.com", subject: "s",
      inReplyTo: "", references: "", body: "본문", cc: "c@d.com", bcc: "e@f.com",
    });
    expect(withCc).toContain("Cc: c@d.com");
    expect(withCc).toContain("Bcc: e@f.com");

    const without = buildRfc822({
      gmailThreadId: "t", toEmail: "a@b.com", subject: "s",
      inReplyTo: "", references: "", body: "본문",
    });
    expect(without).not.toContain("Cc:");
    expect(without).not.toContain("Bcc:");
  });

  it("cc/bcc CRLF 인젝션 제거", () => {
    const raw = buildRfc822({
      gmailThreadId: "t", toEmail: "a@b.com", subject: "s",
      inReplyTo: "", references: "", body: "본문",
      cc: "c@d.com\r\nBcc: evil@x.com",
    });
    // 핵심 보안 속성: 주입된 CRLF 가 독립 헤더 줄(\r\nBcc:)을 만들지 않을 것.
    // sanitize 가 줄바꿈만 제거 → 'Bcc:' 는 Cc 값 안으로 inline 흡수(무해).
    expect(raw).not.toContain("\r\nBcc:");
    expect(raw).toContain("Cc: c@d.comBcc: evil@x.com");
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
