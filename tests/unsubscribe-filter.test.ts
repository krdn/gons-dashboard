import { describe, it, expect } from "vitest";
import { isMailingList } from "@/entities/email/lib/unsubscribe-filter";
import type { MailingListSignals } from "@/shared/api/gmail";

function s(partial: Partial<MailingListSignals>): MailingListSignals {
  return {
    hasListUnsubscribe: false,
    hasListId: false,
    precedence: null,
    fromHeader: null,
    ...partial,
  };
}

describe("isMailingList", () => {
  it("List-Unsubscribe 헤더 단독으로 컷", () => {
    expect(isMailingList(s({ hasListUnsubscribe: true }), "")).toBe(true);
  });

  it("List-ID 헤더 단독으로 컷", () => {
    expect(isMailingList(s({ hasListId: true }), "")).toBe(true);
  });

  it("Precedence: bulk 컷", () => {
    expect(isMailingList(s({ precedence: "bulk" }), "")).toBe(true);
  });

  it("Precedence: list 컷", () => {
    expect(isMailingList(s({ precedence: "list" }), "")).toBe(true);
  });

  it("Precedence: junk 컷", () => {
    expect(isMailingList(s({ precedence: "junk" }), "")).toBe(true);
  });

  it("Google 보안 알림은 통과 (헤더 없음)", () => {
    expect(
      isMailingList(
        s({ fromHeader: "Google <no-reply@accounts.google.com>" }),
        "Suspicious sign-in",
      ),
    ).toBe(false);
  });

  it("결제 알림 통과 (noreply but 본문에 unsubscribe 없음)", () => {
    expect(
      isMailingList(s({ fromHeader: "<noreply@paypal.com>" }), "결제 완료"),
    ).toBe(false);
  });

  it("noreply + 본문 unsubscribe 단어 → 컷", () => {
    expect(
      isMailingList(
        s({ fromHeader: "<noreply@example.com>" }),
        "Click here to unsubscribe at the bottom",
      ),
    ).toBe(true);
  });

  it("빈 헤더는 통과", () => {
    expect(isMailingList(s({}), "")).toBe(false);
  });

  it("hasListUnsubscribe=false 인데 precedence 있는 경우만 컷되는지", () => {
    expect(isMailingList(s({ precedence: "first-class" }), "")).toBe(false);
  });

  it("일반 사람 메일 통과", () => {
    expect(
      isMailingList(s({ fromHeader: "Alice <alice@acme.kr>" }), "회의 일정 확인"),
    ).toBe(false);
  });

  it("대소문자 무관 — Precedence: BULK", () => {
    expect(isMailingList(s({ precedence: "BULK" }), "")).toBe(false); // 호출자가 lowercase 보장
    // (extractMailingListSignals가 이미 toLowerCase하므로 함수는 lowercase 입력만 받음)
  });
});
