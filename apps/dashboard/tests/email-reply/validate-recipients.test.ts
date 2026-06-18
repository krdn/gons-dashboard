// 답장 수신자 형식 검증 — 순수 함수. 쉼표 다중 주소·공백·빈 토큰 엣지.
// sendReply/saveReplyDraft 공유 — 시스템 경계 입력 검증(coding-style).
import { describe, it, expect } from "vitest";
import { validateRecipients } from "@/features/email-reply/lib/validateRecipients";

describe("validateRecipients", () => {
  it("정상 단일 To → ok", () => {
    expect(validateRecipients({ toEmail: "a@b.com" }).ok).toBe(true);
  });

  it("To 비면 → invalid (to)", () => {
    const r = validateRecipients({ toEmail: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("to");
  });

  it("To 형식 오류 → invalid (to)", () => {
    const r = validateRecipients({ toEmail: "not-an-email" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("to");
  });

  it("display-name 형식은 거부 (bare email 만 — 의도적 narrowing)", () => {
    const r = validateRecipients({ toEmail: "홍길동 <a@b.com>" });
    expect(r.ok).toBe(false);
  });

  it("CC 쉼표 다중 + 공백 → trim 후 각각 검증 ok", () => {
    expect(validateRecipients({ toEmail: "a@b.com", cc: "c@d.com, e@f.com" }).ok).toBe(true);
  });

  it("CC 후행 쉼표(빈 토큰) → 필터 후 ok", () => {
    expect(validateRecipients({ toEmail: "a@b.com", cc: "c@d.com," }).ok).toBe(true);
  });

  it("CC 한 토큰이라도 형식 오류 → invalid (cc)", () => {
    const r = validateRecipients({ toEmail: "a@b.com", cc: "c@d.com, bad" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("cc");
  });

  it("BCC 형식 오류 → invalid (bcc)", () => {
    const r = validateRecipients({ toEmail: "a@b.com", bcc: "nope" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("bcc");
  });

  it("CC/BCC undefined → ok (선택 필드)", () => {
    expect(validateRecipients({ toEmail: "a@b.com", cc: undefined, bcc: undefined }).ok).toBe(true);
  });

  it("CC 빈 문자열 → ok (빈 값 허용)", () => {
    expect(validateRecipients({ toEmail: "a@b.com", cc: "" }).ok).toBe(true);
  });
});
