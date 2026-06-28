import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { Card } from "@/shared/ui/Card";

describe("Card padding 매핑", () => {
  it("md는 p-[var(--space-5)] (=24px, p-5≠24px 회귀 가드)", () => {
    const html = renderToStaticMarkup(<Card padding="md">x</Card>);
    expect(html).toContain("p-[var(--space-5)]");
    expect(html).not.toContain(" p-5"); // Tailwind 기본 20px 이탈 방지
  });

  it("sm=p-4, lg=p-6", () => {
    expect(renderToStaticMarkup(<Card padding="sm">x</Card>)).toContain("p-4");
    expect(renderToStaticMarkup(<Card padding="lg">x</Card>)).toContain("p-6");
  });

  it("기본 표면 클래스(rounded + hairline + surface)를 항상 포함", () => {
    const html = renderToStaticMarkup(<Card>x</Card>);
    expect(html).toContain("rounded-xl");
    expect(html).toContain("border-[var(--color-hairline)]");
    expect(html).toContain("bg-[var(--color-surface)]");
  });

  it("tone=dashed는 점선 경계, as=article은 article 태그", () => {
    expect(renderToStaticMarkup(<Card tone="dashed">x</Card>)).toContain("border-dashed");
    expect(renderToStaticMarkup(<Card as="article">x</Card>)).toMatch(/^<article/);
  });

  it("className escape-hatch를 병합한다", () => {
    expect(renderToStaticMarkup(<Card className="border-l-2">x</Card>)).toContain("border-l-2");
  });
});
