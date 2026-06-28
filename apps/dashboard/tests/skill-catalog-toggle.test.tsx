// @vitest-environment jsdom
// SkillCatalog 접기/펼치기 — 이 기능의 핵심 동작(collapsed Set + 검색 연동)을
// 결정적으로 검증. 브라우저 인터랙션의 flakiness 없이 회귀를 잡는다.
// SkillDetail 은 meta=null 일 때 fetch 안 함(if(!meta) return) → 섹션 토글만 하는
// 이 테스트는 fetch 모킹 불필요.
import { afterEach, describe, it, expect } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/react";
import { SkillCatalog } from "@/widgets/skill-catalog/ui/SkillCatalog";
import type { SkillMeta, SkillCategoryMetaMap } from "@/entities/skill/client";

afterEach(cleanup);

function skill(name: string, category: string): SkillMeta {
  return {
    name,
    description: `${name} 설명`,
    version: null,
    model: null,
    source: "standalone",
    category,
    necessity: "unrated",
    necessityReason: "",
    filePath: `~/.claude/skills/${name}/SKILL.md`,
    bodyPath: `/skill-catalog/${name}.json`,
  };
}

const CATEGORIES: SkillCategoryMetaMap = {
  alpha: { label: "알파", order: 1 },
  beta: { label: "베타", order: 2 },
  gamma: { label: "감마", order: 3 },
};

// 알파 3개 / 베타 2개 / 감마 1개 = 총 6.
const SKILLS: SkillMeta[] = [
  skill("a1", "alpha"),
  skill("a2", "alpha"),
  skill("a3", "alpha"),
  skill("b1", "beta"),
  skill("b2", "beta"),
  skill("g1", "gamma"),
];

/** 현재 화면에 보이는(부모 div 가 hidden 아님) 스킬 행 버튼 수. */
function visibleSkillCount(container: HTMLElement): number {
  return [...container.querySelectorAll('ul[role="list"] button')].filter((btn) => {
    // SkillGroupSection 의 래퍼 div[hidden] 안에 있으면 안 보임.
    return !btn.closest("div[hidden]");
  }).length;
}

/** label 로 섹션 헤더 버튼(aria-expanded) 찾기. */
function sectionHeader(container: HTMLElement, label: string): HTMLElement {
  const headers = [...container.querySelectorAll("button[aria-expanded]")] as HTMLElement[];
  const found = headers.find((h) => h.textContent?.includes(label));
  if (!found) throw new Error(`섹션 헤더 "${label}" 없음`);
  return found;
}

describe("SkillCatalog 접기/펼치기", () => {
  it("기본 = 전체 펼침, 모든 스킬 표시", () => {
    const { container } = render(<SkillCatalog skills={SKILLS} categories={CATEGORIES} />);
    const headers = [...container.querySelectorAll("button[aria-expanded]")];
    expect(headers).toHaveLength(3);
    expect(headers.every((h) => h.getAttribute("aria-expanded") === "true")).toBe(true);
    expect(visibleSkillCount(container)).toBe(6);
  });

  it("한 섹션만 접으면 그 섹션 개수만 사라지고 나머지는 펼침 유지 (advisor 판별 기준)", () => {
    const { container } = render(<SkillCatalog skills={SKILLS} categories={CATEGORIES} />);
    // 알파(3개) 섹션만 접기.
    fireEvent.click(sectionHeader(container, "알파"));

    // 알파만 collapsed.
    expect(sectionHeader(container, "알파").getAttribute("aria-expanded")).toBe("false");
    expect(sectionHeader(container, "베타").getAttribute("aria-expanded")).toBe("true");
    expect(sectionHeader(container, "감마").getAttribute("aria-expanded")).toBe("true");

    // 보이는 스킬 = 6 − 3(알파) = 3 (베타 2 + 감마 1).
    expect(visibleSkillCount(container)).toBe(3);
  });

  it("두 섹션 접기는 독립적 — 누적 전체 접힘 버그 없음", () => {
    const { container } = render(<SkillCatalog skills={SKILLS} categories={CATEGORIES} />);
    fireEvent.click(sectionHeader(container, "알파")); // 3 접힘 → 3 보임
    fireEvent.click(sectionHeader(container, "베타")); // +2 접힘 → 1 보임 (감마만)

    expect(sectionHeader(container, "알파").getAttribute("aria-expanded")).toBe("false");
    expect(sectionHeader(container, "베타").getAttribute("aria-expanded")).toBe("false");
    expect(sectionHeader(container, "감마").getAttribute("aria-expanded")).toBe("true");
    expect(visibleSkillCount(container)).toBe(1);
  });

  it("접은 섹션 다시 누르면 펼침 복원 (토글)", () => {
    const { container } = render(<SkillCatalog skills={SKILLS} categories={CATEGORIES} />);
    const alpha = () => sectionHeader(container, "알파");
    fireEvent.click(alpha()); // 접기
    expect(alpha().getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(alpha()); // 펼치기
    expect(alpha().getAttribute("aria-expanded")).toBe("true");
    expect(visibleSkillCount(container)).toBe(6);
  });

  it("검색 중에는 접힌 섹션도 강제 펼침 — 숨은 결과 방지", () => {
    const { container } = render(<SkillCatalog skills={SKILLS} categories={CATEGORIES} />);
    // 알파 접기.
    fireEvent.click(sectionHeader(container, "알파"));
    expect(sectionHeader(container, "알파").getAttribute("aria-expanded")).toBe("false");

    // "a1" 검색 — 알파 섹션이 매칭이므로 강제 펼침.
    const input = container.querySelector('input[type="search"]')!;
    fireEvent.change(input, { target: { value: "a1" } });

    expect(sectionHeader(container, "알파").getAttribute("aria-expanded")).toBe("true");
    // 매칭된 a1 만 보임.
    expect(visibleSkillCount(container)).toBe(1);
  });

  it("검색 해제 시 수동 접힘 상태 복원", () => {
    const { container } = render(<SkillCatalog skills={SKILLS} categories={CATEGORIES} />);
    fireEvent.click(sectionHeader(container, "알파")); // 수동 접기
    const input = container.querySelector('input[type="search"]')!;
    fireEvent.change(input, { target: { value: "a1" } }); // 검색 → 강제 펼침
    expect(sectionHeader(container, "알파").getAttribute("aria-expanded")).toBe("true");
    fireEvent.change(input, { target: { value: "" } }); // 검색 해제
    // 수동 접힘이 복원돼야 (collapsed Set 보존).
    expect(sectionHeader(container, "알파").getAttribute("aria-expanded")).toBe("false");
  });

  it("'모두 접기' 버튼은 전체 접힘, 다시 누르면 전체 펼침", () => {
    const { container } = render(<SkillCatalog skills={SKILLS} categories={CATEGORIES} />);
    const toggleAll = within(container).getByText("모두 접기");
    fireEvent.click(toggleAll);
    const headers = [...container.querySelectorAll("button[aria-expanded]")];
    expect(headers.every((h) => h.getAttribute("aria-expanded") === "false")).toBe(true);
    expect(visibleSkillCount(container)).toBe(0);

    // 라벨이 "모두 펼치기"로 바뀜.
    const toggleAll2 = within(container).getByText("모두 펼치기");
    fireEvent.click(toggleAll2);
    const headers2 = [...container.querySelectorAll("button[aria-expanded]")];
    expect(headers2.every((h) => h.getAttribute("aria-expanded") === "true")).toBe(true);
    expect(visibleSkillCount(container)).toBe(6);
  });
});
