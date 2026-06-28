import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SkillSummaryBox } from "@/widgets/skill-catalog/ui/SkillSummaryBox";

describe("SkillSummaryBox", () => {
  it("summaryKo 없으면 아무것도 렌더하지 않음 (번역 없는 스킬 graceful)", () => {
    expect(renderToStaticMarkup(<SkillSummaryBox summaryKo={null} />)).toBe("");
  });

  it("빈 문자열도 박스 생략 (falsy 처리)", () => {
    expect(renderToStaticMarkup(<SkillSummaryBox summaryKo="" />)).toBe("");
  });

  it("summaryKo 있으면 '📌 한눈에' 헤더 + 요약 박스 렌더", () => {
    const html = renderToStaticMarkup(<SkillSummaryBox summaryKo="첫 줄.\n둘째 줄." />);
    expect(html).toContain("📌 한눈에");
    expect(html).toContain("aside");
  });

  it("줄바꿈(\\n)을 별도 <p>로 분리 렌더", () => {
    const html = renderToStaticMarkup(<SkillSummaryBox summaryKo={"A.\nB.\nC."} />);
    // 요약 3줄 → <p> 3개 (헤더 <p> 1개 포함 총 4개)
    const pCount = (html.match(/<p\b/g) ?? []).length;
    expect(pCount).toBe(4);
    expect(html).toContain("A.");
    expect(html).toContain("C.");
  });
});
