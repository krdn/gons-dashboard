// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Highlighted, splitByTerms } from "./Highlighted";

afterEach(cleanup);

describe("splitByTerms", () => {
  it("일치 구간을 hit 조각으로 분절한다", () => {
    expect(splitByTerms("LG유플러스 위약금 문의", ["위약금"])).toEqual([
      { text: "LG유플러스 ", hit: false },
      { text: "위약금", hit: true },
      { text: " 문의", hit: false },
    ]);
  });

  it("terms가 비면 전체를 평문 한 조각으로 돌려준다", () => {
    expect(splitByTerms("메모 본문", [])).toEqual([{ text: "메모 본문", hit: false }]);
    expect(splitByTerms("메모 본문", ["  "])).toEqual([{ text: "메모 본문", hit: false }]);
  });

  it("대소문자를 무시하고 원문 표기를 보존한다", () => {
    expect(splitByTerms("Persona Prompting", ["persona"])).toEqual([
      { text: "Persona", hit: true },
      { text: " Prompting", hit: false },
    ]);
  });

  it("겹치는 토큰은 긴 쪽이 통으로 매칭된다", () => {
    expect(splitByTerms("메모검색 기능", ["메모", "메모검색"])).toEqual([
      { text: "메모검색", hit: true },
      { text: " 기능", hit: false },
    ]);
  });

  it("정규식 메타문자를 리터럴로 취급한다", () => {
    expect(splitByTerms("비율 100% (확정)", ["100%", "(확정)"])).toEqual([
      { text: "비율 ", hit: false },
      { text: "100%", hit: true },
      { text: " ", hit: false },
      { text: "(확정)", hit: true },
    ]);
  });

  it("연속 일치는 각각의 조각으로 나온다", () => {
    expect(splitByTerms("가나가나", ["가나"])).toEqual([
      { text: "가나", hit: true },
      { text: "가나", hit: true },
    ]);
  });
});

describe("Highlighted", () => {
  it("hit 조각을 <mark>로 감싼다", () => {
    const { container } = render(<Highlighted text="회의는 세 시" terms={["세 시"]} />);
    const marks = container.querySelectorAll("mark");
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe("세 시");
    expect(container.textContent).toBe("회의는 세 시");
  });

  it("terms가 비면 mark 없이 평문 렌더", () => {
    const { container } = render(<Highlighted text="회의는 세 시" terms={[]} />);
    expect(container.querySelectorAll("mark").length).toBe(0);
    expect(container.textContent).toBe("회의는 세 시");
  });
});
