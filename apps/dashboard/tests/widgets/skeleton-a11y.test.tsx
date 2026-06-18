// @vitest-environment jsdom
// 로딩 스켈레톤 a11y 구조 회귀 — 상태 텍스트(role=status)는 aria-hidden 조상을
// 가지면 안 된다. aria-hidden=true 는 자손까지 접근성 트리에서 제거하므로,
// sr-only "불러오는 중" 을 aria-hidden 컨테이너 안에 두면 SR 이 절대 못 읽는다
// (감사 #3 수정 중 발견한 latent no-op). 두 스켈레톤이 동일 패턴인지도 단언.
import { afterEach, describe, it, expect } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { EmailDigestSkeleton } from "@/widgets/email-digest/ui/EmailDigestSkeleton";
import { ImportantEmailsSkeleton } from "@/widgets/important-emails/ui/ImportantEmailsSkeleton";

afterEach(cleanup);

const skeletons = [
  { name: "EmailDigestSkeleton", Comp: EmailDigestSkeleton },
  { name: "ImportantEmailsSkeleton", Comp: ImportantEmailsSkeleton },
];

describe.each(skeletons)("$name a11y 구조", ({ Comp }) => {
  it("role=status 상태 텍스트가 aria-hidden 조상 밖에 있어 SR 이 읽을 수 있다", () => {
    const { getByRole } = render(<Comp />);
    const status = getByRole("status");
    expect(status.textContent).toContain("불러오는 중");
    // aria-hidden 조상이 있으면 접근성 트리에서 빠져 announce 불가.
    expect(status.closest('[aria-hidden="true"]')).toBeNull();
  });

  it("시각 placeholder 는 aria-hidden 으로 트리에서 제외된다", () => {
    const { container } = render(<Comp />);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
