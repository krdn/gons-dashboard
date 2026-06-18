// CRITICAL §3 #3 #4 회귀 방지 — 결정적 1차 분류기.
//
// 정책:
//  1. 마지막 발송자가 본인 → null
//  2. 한/영 마감·긴급 키워드 → high 후보
//  3. 한/영 질문 키워드 → med 후보
//  4. 단서 없음 → null

import { describe, it, expect } from "vitest";
import { classifyDeterministic } from "@/entities/email/lib/deterministic-classifier";
import type { ThreadInput } from "@/entities/email/model/types";

const baseInput: ThreadInput = {
  threadId: "thread-1",
  lastSenderEmail: "alice@acme.kr",
  lastSenderName: "Alice",
  subject: "안녕하세요",
  snippet: "잘 지내시죠?",
  receivedAt: new Date(),
  ownerEmail: "owner@gmail.com",
  lastSenderIsOwner: false,
};

describe("classifyDeterministic", () => {
  it("CRITICAL #3 — 마지막 발송자가 본인이면 null", () => {
    expect(
      classifyDeterministic({
        ...baseInput,
        lastSenderIsOwner: true,
      }),
    ).toBeNull();
  });

  it("CRITICAL #3 — lastSenderEmail이 ownerEmail이면 null", () => {
    expect(
      classifyDeterministic({
        ...baseInput,
        lastSenderEmail: "owner@gmail.com",
        lastSenderIsOwner: false, // 플래그 미설정이어도 이메일로 잡힘
      }),
    ).toBeNull();
  });

  it("CRITICAL #4 — 한국어 마감 키워드 → high", () => {
    const result = classifyDeterministic({
      ...baseInput,
      subject: "제휴 계약서",
      snippet: "5월 12일까지 회신 부탁드립니다",
    });
    expect(result?.severity).toBe("high");
    expect(result?.classifiedBy).toBe("deterministic");
  });

  it("CRITICAL #4 — 영어 deadline → high", () => {
    const result = classifyDeterministic({
      ...baseInput,
      subject: "Q3 review",
      snippet: "Please respond by EOD Friday — this is a hard deadline.",
    });
    expect(result?.severity).toBe("high");
  });

  it("CRITICAL #4 — 한국어 질문 → med", () => {
    const result = classifyDeterministic({
      ...baseInput,
      subject: "자료 공유",
      snippet: "스프린트 회고에서 말씀하신 자료 공유 가능하신가요?",
    });
    expect(result?.severity).toBe("med");
  });

  it("CRITICAL #4 — 영어 질문 → med", () => {
    const result = classifyDeterministic({
      ...baseInput,
      subject: "Sync next week",
      snippet: "Could you let me know if Tuesday works?",
    });
    expect(result?.severity).toBe("med");
  });

  it("정책 4 — 단서 없는 인사말 → null", () => {
    expect(
      classifyDeterministic({
        ...baseInput,
        subject: "Hello from Acme",
        snippet: "Just saying hi",
      }),
    ).toBeNull();
  });

  it("'긴급' 키워드 → high", () => {
    const result = classifyDeterministic({
      ...baseInput,
      subject: "[긴급] 서버 점검 안내",
      snippet: "지금 서버에 문제가 생겼습니다",
    });
    expect(result?.severity).toBe("high");
  });

  it("subject + snippet 둘 다 평이 → null", () => {
    // 분류기는 "부탁/요청/드립니다" 같은 동사가 들어가면 med로 잡음.
    // 평이한 정보 메일은 그런 동사 없이 끝나야 null.
    expect(
      classifyDeterministic({
        ...baseInput,
        subject: "주간 뉴스레터 제24호",
        snippet: "이번 주 업계 동향 정리.",
      }),
    ).toBeNull();
  });

  // '드립니다' 단독 패턴 제거 회귀 — 정중 맺음말은 답장 요청이 아니다.
  // 비용 누수 방지: 정중한 한국어 메일이 prefilter 통과해 Haiku 직행하던 문제.
  describe("정중 맺음말 '드립니다' — null (비용 누수 방지)", () => {
    const closings = [
      { subject: "월간 리포트", snippet: "이번 달 실적을 보고드립니다" },
      { subject: "서비스 점검 안내", snippet: "정기 점검 일정을 안내드립니다" },
      { subject: "감사 인사", snippet: "그동안의 협조에 감사드립니다" },
      { subject: "변경 공지", snippet: "약관 개정 사항을 말씀드립니다" },
    ];
    for (const c of closings) {
      it(`"${c.snippet}" → null`, () => {
        expect(classifyDeterministic({ ...baseInput, ...c })).toBeNull();
      });
    }
  });

  describe("회신 의도가 분명한 요청 — 여전히 잡힘 (진짜 양성 보존)", () => {
    it("'회신 부탁드립니다' → high", () => {
      const r = classifyDeterministic({
        ...baseInput,
        subject: "견적서",
        snippet: "검토 후 회신 부탁드립니다",
      });
      expect(r?.severity).toBe("high");
    });

    it("'부탁' 단독 → med (요청 신호 유지)", () => {
      const r = classifyDeterministic({
        ...baseInput,
        subject: "자료 공유",
        snippet: "확인 한번 부탁 좀 드려요",
      });
      expect(r?.severity).toBe("med");
    });

    it("'요청' 단독 → med (요청 신호 유지)", () => {
      const r = classifyDeterministic({
        ...baseInput,
        subject: "수정 요청 사항",
        snippet: "아래 항목 반영 요청",
      });
      expect(r?.severity).toBe("med");
    });
  });

  it("이메일 비교는 case-insensitive", () => {
    expect(
      classifyDeterministic({
        ...baseInput,
        lastSenderEmail: "OWNER@gmail.com",
        ownerEmail: "owner@gmail.com",
      }),
    ).toBeNull();
  });
});
