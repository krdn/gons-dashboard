import { describe, expect, it } from "vitest";
import { SCHOOL_SCHEMAS } from "./schemas";

const dummy200 = "가".repeat(200);
const dummy1500 = "나".repeat(1500);

function baseOk() {
  return {
    narrativeText: dummy1500,
    sections: {
      personality: dummy200,
      career: dummy200,
      relationship: dummy200,
      health: dummy200,
      daeunSummary: dummy200,
      keyTerms: [
        { term: "傷官格", gloss: "상관격 — ..." },
        { term: "怪罡", gloss: "괴강 — ..." },
        { term: "桃花", gloss: "도화 — ..." },
      ],
      cautions: ["과로 주의"],
    },
    citations: ["적천수·통신론", "삼명통회·신살편"],
  };
}

describe("SCHOOL_SCHEMAS — ko", () => {
  it("유효 ko 페이로드 통과", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        joohuFocus: "다".repeat(70),
        shinsalNotes: ["괴강 — 강한 자존심"],
      },
    };
    expect(() => SCHOOL_SCHEMAS.ko.parse(payload)).not.toThrow();
  });

  it("joohuFocus 70자 미만 → throw", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: { joohuFocus: "짧음", shinsalNotes: ["x"] },
    };
    expect(() => SCHOOL_SCHEMAS.ko.parse(payload)).toThrow();
  });

  it("cn-ziping schoolSpecific 을 ko 로 검증 → throw (분기 보장)", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        gyeokgukRationale: "라".repeat(100),
        yongshinAnalysis: "마".repeat(100),
      },
    };
    expect(() => SCHOOL_SCHEMAS.ko.parse(payload)).toThrow();
  });
});

describe("SCHOOL_SCHEMAS — cn-ziping", () => {
  it("유효 ziping 페이로드 통과", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        gyeokgukRationale: "라".repeat(100),
        yongshinAnalysis: "마".repeat(100),
      },
    };
    expect(() => SCHOOL_SCHEMAS["cn-ziping"].parse(payload)).not.toThrow();
  });
});

describe("SCHOOL_SCHEMAS — cn-mangpai", () => {
  it("eventTimings 3건 통과", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        eventTimings: [
          { period: "30~35세 戊辰 대운", event: "재물 변동" },
          { period: "45세 庚午 년", event: "가족 변고" },
          { period: "50대 초반", event: "이동·이사" },
        ],
      },
    };
    expect(() => SCHOOL_SCHEMAS["cn-mangpai"].parse(payload)).not.toThrow();
  });

  it("eventTimings 2건 → throw (min 3)", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        eventTimings: [
          { period: "a", event: "b" },
          { period: "c", event: "d" },
        ],
      },
    };
    expect(() => SCHOOL_SCHEMAS["cn-mangpai"].parse(payload)).toThrow();
  });
});

describe("SCHOOL_SCHEMAS — jp", () => {
  it("palaceMap 5건 통과", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        palaceMap: [
          { palace: "命宮(명궁)", note: "..." },
          { palace: "財帛宮(재백궁)", note: "..." },
          { palace: "兄弟宮(형제궁)", note: "..." },
          { palace: "田宅宮(전택궁)", note: "..." },
          { palace: "官祿宮(관록궁)", note: "..." },
        ],
      },
    };
    expect(() => SCHOOL_SCHEMAS.jp.parse(payload)).not.toThrow();
  });

  it("palaceMap 4건 → throw (min 5)", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        palaceMap: [
          { palace: "a", note: "1" },
          { palace: "b", note: "2" },
          { palace: "c", note: "3" },
          { palace: "d", note: "4" },
        ],
      },
    };
    expect(() => SCHOOL_SCHEMAS.jp.parse(payload)).toThrow();
  });
});

describe("SCHOOL_SCHEMAS — 공통 base 검증", () => {
  it("narrativeText 1500자 미만 → throw", () => {
    const payload = {
      ...baseOk(),
      narrativeText: "짧음",
      schoolSpecific: {
        joohuFocus: "다".repeat(70),
        shinsalNotes: ["x"],
      },
    };
    expect(() => SCHOOL_SCHEMAS.ko.parse(payload)).toThrow();
  });

  // Hotfix #2: min 약화로 boundary 갱신 — citations/keyTerms min 1.
  it("citations 0개 → throw (min 1)", () => {
    const payload = {
      ...baseOk(),
      citations: [],
      schoolSpecific: {
        joohuFocus: "다".repeat(70),
        shinsalNotes: ["x"],
      },
    };
    expect(() => SCHOOL_SCHEMAS.ko.parse(payload)).toThrow();
  });

  it("keyTerms 0개 → throw (min 1)", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: { joohuFocus: "다".repeat(70), shinsalNotes: ["x"] },
    };
    payload.sections.keyTerms = [];
    expect(() => SCHOOL_SCHEMAS.ko.parse(payload)).toThrow();
  });
});
