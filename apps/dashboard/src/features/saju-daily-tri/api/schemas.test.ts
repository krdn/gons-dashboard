import { describe, it, expect } from "vitest";
import { SCHOOL_SCHEMAS } from "./schemas";

const baseValid = {
  narrativeText: "오늘 일운에 대한 충분히 긴 설명문장. ".repeat(20),
  sections: {
    personality: "오늘 성격 분석. ".repeat(5),
    career: "오늘 진로 조언. ".repeat(5),
    relationship: "오늘 관계 조언. ".repeat(5),
    health: "오늘 건강 조언. ".repeat(5),
    daeunSummary: "오늘 흐름 요약. ".repeat(5),
    keyTerms: [{ term: "일운", gloss: "오늘 하루의 운" }],
    cautions: ["오후에 무리한 결정 피하기"],
  },
  citations: ["적천수 권1", "자평진전 격국편"],
};

describe("SCHOOL_SCHEMAS — ko", () => {
  it("parses valid ko payload", () => {
    const result = SCHOOL_SCHEMAS.ko.parse({
      ...baseValid,
      schoolSpecific: {
        joohuFocus: "오늘은 火 부족 — 양기 보충 필요. 따뜻한 음식과 양지 활동 권장.",
        shinsalNotes: ["천을귀인 활성"],
      },
    });
    expect(result.sections.keyTerms).toHaveLength(1);
  });

  it("fails when narrativeText < 200", () => {
    expect(() =>
      SCHOOL_SCHEMAS.ko.parse({
        ...baseValid,
        narrativeText: "짧음",
        schoolSpecific: {
          joohuFocus: "오늘은 火 부족 — 양기 보충 필요. 따뜻한 음식과 양지 활동 권장.",
          shinsalNotes: ["천을귀인 활성"],
        },
      }),
    ).toThrow();
  });

  it("normalizes object shinsalNotes to string array (Gemini hotfix)", () => {
    const result = SCHOOL_SCHEMAS.ko.parse({
      ...baseValid,
      schoolSpecific: {
        joohuFocus: "오늘은 火 부족 — 양기 보충 필요. 따뜻한 음식과 양지 활동 권장.",
        shinsalNotes: { 천을귀인: "활성" },
      },
    });
    expect(result.schoolSpecific.shinsalNotes).toEqual(["천을귀인: 활성"]);
  });

  it("defaults missing keyTerms to []", () => {
    const result = SCHOOL_SCHEMAS.ko.parse({
      ...baseValid,
      sections: { ...baseValid.sections, keyTerms: undefined },
      schoolSpecific: {
        joohuFocus: "오늘은 火 부족 — 양기 보충 필요. 따뜻한 음식과 양지 활동 권장.",
        shinsalNotes: ["천을귀인 활성"],
      },
    });
    expect(result.sections.keyTerms).toEqual([]);
  });
});

describe("SCHOOL_SCHEMAS — cn-ziping", () => {
  it("parses valid ziping payload", () => {
    const result = SCHOOL_SCHEMAS["cn-ziping"].parse({
      ...baseValid,
      schoolSpecific: {
        gyeokgukRationale: "정관격 성립 — 월령에 정관이 투출하여 격국이 명확하고 일주가 굳건",
        yongshinAnalysis: "용신 木이 오늘 寅日을 만나 강화되어 사업 추진력 상승",
      },
    });
    expect(result.schoolSpecific.gyeokgukRationale).toBeTruthy();
  });

  it("fails when gyeokgukRationale < 30", () => {
    expect(() =>
      SCHOOL_SCHEMAS["cn-ziping"].parse({
        ...baseValid,
        schoolSpecific: {
          gyeokgukRationale: "짧음",
          yongshinAnalysis: "용신 木이 오늘 寅日을 만나 강화되어 사업 추진력 상승",
        },
      }),
    ).toThrow();
  });
});

describe("SCHOOL_SCHEMAS — cn-mangpai", () => {
  it("parses valid mangpai payload (3 eventTimings)", () => {
    const result = SCHOOL_SCHEMAS["cn-mangpai"].parse({
      ...baseValid,
      schoolSpecific: {
        eventTimings: [
          { period: "오전 9-11시", event: "재물 입금" },
          { period: "정오", event: "관계 갈등" },
          { period: "저녁 19시 이후", event: "이동" },
        ],
      },
    });
    expect(result.schoolSpecific.eventTimings).toHaveLength(3);
  });

  it("fails when eventTimings < 3", () => {
    expect(() =>
      SCHOOL_SCHEMAS["cn-mangpai"].parse({
        ...baseValid,
        schoolSpecific: {
          eventTimings: [{ period: "오전", event: "단독" }],
        },
      }),
    ).toThrow();
  });

  it("fails when eventTimings > 5", () => {
    expect(() =>
      SCHOOL_SCHEMAS["cn-mangpai"].parse({
        ...baseValid,
        schoolSpecific: {
          eventTimings: Array.from({ length: 6 }, (_, i) => ({
            period: `period ${i}`,
            event: `event ${i}`,
          })),
        },
      }),
    ).toThrow();
  });
});

describe("SCHOOL_SCHEMAS — jp", () => {
  it("parses valid jp payload (3 palaceMap)", () => {
    const result = SCHOOL_SCHEMAS.jp.parse({
      ...baseValid,
      schoolSpecific: {
        palaceMap: [
          { palace: "命宮", note: "자기 표현 강화" },
          { palace: "財帛宮", note: "재물 흐름 활성" },
          { palace: "官祿宮", note: "직장 안정" },
        ],
      },
    });
    expect(result.schoolSpecific.palaceMap).toHaveLength(3);
  });
});
