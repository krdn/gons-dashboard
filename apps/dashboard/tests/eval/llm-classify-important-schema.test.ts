// 중요 트랙 ResponseSchema 직접 단위 테스트 — summary/rationale 길이 회귀 가드.
// 게이트웨이가 앱이 넘긴 이 스키마로 내부 검증하므로(tryParseAndValidate),
// 길이 제약이 verdict(category/importance)를 무효화하지 않는지 스키마를 직접 친다.
// mock·LLM·DB 의존 없음.
import { describe, it, expect } from "vitest";
import { ResponseSchema } from "@/shared/lib/llm/classify-important";

describe("중요 트랙 ResponseSchema 길이", () => {
  it("200자 초과 summary/rationale도 수용한다 (verdict 무효화 방지)", () => {
    const result = ResponseSchema.safeParse({
      category: "money",
      importance: "high",
      summary: "가".repeat(300),
      rationale: "나".repeat(300),
    });
    expect(result.success).toBe(true);
  });
});
