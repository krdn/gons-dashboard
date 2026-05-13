import { describe, expect, it } from "vitest";
import { splitMajorFortuneBody } from "./splitMajorFortuneBody";

describe("splitMajorFortuneBody", () => {
  it("정상 10단락 — 10개 segment 반환", () => {
    const body = [
      "**8세 壬寅 (1974~)** — 편관 대운으로 청소년기 학업이...",
      "",
      "**18세 辛丑 (1984~)** — 정관 대운으로 직장...",
      "",
      "**28세 庚子 (1994~)** — ...",
      "",
      "**38세 己亥 (2004~)** — ...",
      "",
      "**48세 戊戌 (2014~)** — ...",
      "",
      "**58세 丁酉 (2024~)** — 현재 진행 중 ...",
      "",
      "**68세 丙申 (2034~)** — ...",
      "",
      "**78세 乙未 (2044~)** — ...",
      "",
      "**88세 甲午 (2054~)** — ...",
      "",
      "**98세 癸巳 (2064~)** — ...",
      "",
      "**올해 흐름** — 2026년 丙午...",
    ].join("\n");

    const segments = splitMajorFortuneBody(body);
    expect(segments).toHaveLength(10);
    expect(segments[0]).toMatchObject({ age: 8, ganZhi: "壬寅" });
    expect(segments[5]).toMatchObject({ age: 58, ganZhi: "丁酉" });
    expect(segments[9]).toMatchObject({ age: 98, ganZhi: "癸巳" });
    expect(segments[5].body).toContain("현재 진행 중");
  });

  it("패턴 매칭 안 됨 — 빈 배열", () => {
    const body = "자유 형식 대운 풀이입니다.";
    expect(splitMajorFortuneBody(body)).toHaveLength(0);
  });

  it("8개 미만 → 빈 배열 가까운 결과 (caller가 fallback 결정)", () => {
    const body = [
      "**8세 壬寅** — ...",
      "**18세 辛丑** — ...",
    ].join("\n\n");
    const segments = splitMajorFortuneBody(body);
    expect(segments.length).toBeLessThan(8);
  });
});
