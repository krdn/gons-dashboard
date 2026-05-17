import { describe, expect, it, vi } from "vitest";
import { buildTriNationLifetime, deriveDaeunDirection } from "./lifetime";

/**
 * `{ spy: true }` 옵션은 모든 named export 를 spy 로 감싸되 default 는 real impl 을
 * 그대로 호출한다. 개별 it() 에서 `mockReturnValueOnce` / `mockImplementationOnce`
 * 로 1회성 오버라이드 → 다른 테스트로 전파되지 않음 (mockRestore 불필요).
 * vitest 4 의 ESM-friendly 패턴 — `vi.spyOn(namespace, "fn")` 는 ESM live binding
 * 위에서 일관되지 않으므로 회피한다.
 */
vi.mock("../consensus", { spy: true });
vi.mock("../adapters/ko/lifetime", { spy: true });

// mock 후 import — vi.mock 은 호이스팅되므로 실제 import 순서와 무관하지만,
// 가독성 위해 모듈 spy 선언 뒤에 둔다.
import * as consensusMod from "../consensus";
import * as koLifetimeMod from "../adapters/ko/lifetime";

/**
 * Phase 5 compose 회귀 — 1967-03-29 05:30 KST 男 (서울) fixture.
 *
 * 검증 항목:
 * - 4 어댑터 frame 모두 생성 + school 라벨 정확.
 * - daeun.direction: 음간(丁) + 男 → "backward" (daeun/extended.test.ts 와 일치).
 * - daeun.startAge: 8 (입대운).
 * - trueSolar: Seoul 표준자오선 135°E 대비 126.78°E → 약 -33분 보정.
 * - crossCheck.gyeokgukConsensus.consensus: v0.1 어댑터 4종이 서로 다른 격국명
 *   사용 → 의도적 false (cn-mangpai/jp 가 학파별 고유 라벨 사용).
 */
describe("buildTriNationLifetime", () => {
  const result = buildTriNationLifetime({
    birthDateLocal: "1967-03-29",
    birthTimeLocal: "05:30",
    timezone: "Asia/Seoul",
    longitudeDeg: 126.78,
    calendar: "solar",
    gender: "male",
  });

  it("ok=true 반환 (만세력 라이브러리 합의 통과)", () => {
    expect(result.ok).toBe(true);
  });

  it("4 학파 frame 모두 생성 + school 라벨 정확", () => {
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.frames.ko.school).toBe("ko");
    expect(result.value.frames.cnZiping.school).toBe("cn-ziping");
    expect(result.value.frames.cnMangpai.school).toBe("cn-mangpai");
    expect(result.value.frames.jp.school).toBe("jp");
  });

  it("daeun direction = backward (음간 丁 + 男)", () => {
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.daeun.direction).toBe("backward");
    expect(result.value.daeun.startAge).toBe(8);
    expect(result.value.daeun.pillars).toHaveLength(10);
    // 첫 대운 = 壬寅 (月柱 癸卯 의 한 칸 retrograde)
    expect(result.value.daeun.pillars[0]?.stem).toBe("壬");
    expect(result.value.daeun.pillars[0]?.branch).toBe("寅");
  });

  it("trueSolar 메타: Seoul 126.78°E 보정 (135°E 대비 약 -33분)", () => {
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.trueSolar.hourKnown).toBe(true);
    // (126.78 - 135) * 4 = -32.88 → round → -33
    expect(result.value.trueSolar.trueSolarMinutesOffset).toBe(-33);
  });

  it("chart.shensha + interactions 포함 (ExtendedChart 4 필드)", () => {
    if (!result.ok) throw new Error("expected ok");
    expect(Array.isArray(result.value.chart.shensha)).toBe(true);
    expect(result.value.chart.interactions).toBeDefined();
    expect(result.value.chart.trueSolarMinutesOffset).toBe(-33);
  });

  it("crossCheck.gyeokgukConsensus = false (4 어댑터 격국명 서로 상이)", () => {
    if (!result.ok) throw new Error("expected ok");
    // v0.1: ko/cn-ziping → chart.pattern, cn-mangpai → "맹파는 격국 약화", jp → "추명학은 격국 단순화"
    // 따라서 4 항목이 모두 동일하지 않음.
    expect(result.value.crossCheck.gyeokgukConsensus.consensus).toBe(false);
    expect(result.value.crossCheck.gyeokgukConsensus.schools["cn-mangpai"]).toBe(
      "맹파는 격국 약화",
    );
    expect(result.value.crossCheck.gyeokgukConsensus.schools["jp"]).toBe(
      "추명학은 격국 단순화",
    );
  });

  it("crossCheck.pillarsAgree = true (v0.1 어댑터 pillarsAnnotated 미구현 — trivial true)", () => {
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.crossCheck.pillarsAgree).toBe(true);
  });

  it("crossCheck.yongshinConflicts = [] (v0.1: yongshin 계산 미구현 — 4 어댑터 모두 undefined)", () => {
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.crossCheck.yongshinConflicts).toEqual([]);
  });

  // DESIGN-GAP (a): TriNationLifetime.rawChart — 단일 호출로 원본 SajuChart 동반 노출
  it("rawChart: 원본 SajuChart 노출 (pillars/elements/pattern/tenGods/strength/majorFortunes)", () => {
    if (!result.ok) throw new Error("expected ok");
    const { rawChart } = result.value;
    expect(rawChart.pillars.year.stem).toBe("丁");
    expect(rawChart.pillars.year.branch).toBe("未");
    // 일주 = 壬辰 (MEMORY: G1 일주 정정)
    expect(rawChart.pillars.day.stem).toBe("壬");
    expect(rawChart.pillars.day.branch).toBe("辰");
    expect(rawChart.elements).toBeDefined();
    expect(rawChart.tenGods).toBeDefined();
    expect(rawChart.strength).toBeDefined();
    expect(Array.isArray(rawChart.majorFortunes)).toBe(true);
  });
});

// IMP-3: deriveDaeunDirection 4 quadrant 단위 검증
describe("deriveDaeunDirection", () => {
  it("양간(甲) + 男 → forward", () => {
    expect(deriveDaeunDirection("甲", "male")).toBe("forward");
  });
  it("양간(庚) + 女 → backward", () => {
    expect(deriveDaeunDirection("庚", "female")).toBe("backward");
  });
  it("음간(乙) + 男 → backward", () => {
    expect(deriveDaeunDirection("乙", "male")).toBe("backward");
  });
  it("음간(辛) + 女 → forward", () => {
    expect(deriveDaeunDirection("辛", "female")).toBe("forward");
  });
});

// IMP-4: hourAmbiguity 분기 — 01:30 KST + Seoul 진태양시 보정(-33분) → 진태양시 00:57 → 子/丑 경계 ambiguity
describe("buildTriNationLifetime — hourAmbiguity (IMP-4)", () => {
  it("진태양시 子→丑 경계 시각 → chart.hourAmbiguity 채워짐", () => {
    const result = buildTriNationLifetime({
      birthDateLocal: "1967-03-29",
      birthTimeLocal: "01:30",
      timezone: "Asia/Seoul",
      longitudeDeg: 126.78,
      calendar: "solar",
      gender: "male",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok=true");
    expect(result.value.chart.hourAmbiguity).toBeDefined();
    const ambig = result.value.chart.hourAmbiguity!;
    expect(ambig.candidateBranches).toHaveLength(2);
    expect(ambig.candidateBranches).toEqual(["子", "丑"]);
    expect(ambig.boundaryHour).toBe(1);
  });
});

describe("buildTriNationLifetime — error path", () => {
  it("lunar input → throw (consensus 미지원)", () => {
    expect(() =>
      buildTriNationLifetime({
        birthDateLocal: "1967-03-29",
        birthTimeLocal: "05:30",
        timezone: "Asia/Seoul",
        longitudeDeg: 126.78,
        calendar: "lunar",
        gender: "male",
      }),
    ).toThrow();
  });
});

/**
 * IMP-1: verifyConsensus 가 ok=false 를 반환할 때 buildTriNationLifetime 이
 * `{ ok: false, error: { code: "LIBRARY_MISMATCH", details: { libA, libB } } }`
 * 계약을 지키는지 검증.
 *
 * mockReturnValueOnce 로 1회성 오버라이드 → 다른 테스트로 전파 안 됨.
 */
describe("buildTriNationLifetime — LIBRARY_MISMATCH (IMP-1)", () => {
  it("verifyConsensus ok=false → result.ok=false + error.code=LIBRARY_MISMATCH", () => {
    vi.mocked(consensusMod.verifyConsensus).mockReturnValueOnce({
      ok: false,
      libA: { stem: "壬", branch: "辰" },
      libB: { stem: "癸", branch: "巳" },
    });

    const result = buildTriNationLifetime({
      birthDateLocal: "1967-03-29",
      birthTimeLocal: "05:30",
      timezone: "Asia/Seoul",
      longitudeDeg: 126.78,
      calendar: "solar",
      gender: "male",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok=false");
    expect(result.error.code).toBe("LIBRARY_MISMATCH");
    expect(result.error.message).toBe("만세력 라이브러리 결과 불일치");
    expect(result.error.details).toEqual({
      libA: { stem: "壬", branch: "辰" },
      libB: { stem: "癸", branch: "巳" },
    });
  });
});

/**
 * IMP-2: safeFrame 폴백 — 단일 어댑터가 throw 해도 나머지 3 frame 은 정상 반환되고,
 * 실패한 frame 은 `formatGyeokguk.name === "분석 실패"` + cautions/schoolSpecific.error
 * 로 명시.
 *
 * ko 어댑터를 mockImplementationOnce 로 throw 시켜 ko 만 폴백, cn-ziping/cn-mangpai/jp
 * 는 real impl 그대로 동작.
 */
describe("buildTriNationLifetime — safeFrame fallback (IMP-2)", () => {
  it("ko 어댑터 throw → ko 만 분석 실패 + 나머지 3 frame 정상", () => {
    vi.mocked(koLifetimeMod.buildLifetimeKo).mockImplementationOnce(() => {
      throw new Error("ko adapter test failure");
    });

    const result = buildTriNationLifetime({
      birthDateLocal: "1967-03-29",
      birthTimeLocal: "05:30",
      timezone: "Asia/Seoul",
      longitudeDeg: 126.78,
      calendar: "solar",
      gender: "male",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok=true");

    // ko frame: safeFrame 폴백 발화
    expect(result.value.frames.ko.school).toBe("ko");
    expect(result.value.frames.ko.formatGyeokguk.name).toBe("분석 실패");
    expect(result.value.frames.ko.cautions).toContain("이 학파 분석에 실패했습니다.");
    expect(result.value.frames.ko.pillarsAnnotated).toEqual([]);
    const koSchoolSpecific = result.value.frames.ko.schoolSpecific as { error?: string };
    expect(koSchoolSpecific.error).toContain("ko adapter test failure");

    // 나머지 3 frame: 정상 (분석 실패 가 아닌 정상 격국명)
    expect(result.value.frames.cnZiping.school).toBe("cn-ziping");
    expect(result.value.frames.cnZiping.formatGyeokguk.name).not.toBe("분석 실패");
    expect(result.value.frames.cnMangpai.school).toBe("cn-mangpai");
    expect(result.value.frames.cnMangpai.formatGyeokguk.name).not.toBe("분석 실패");
    expect(result.value.frames.jp.school).toBe("jp");
    expect(result.value.frames.jp.formatGyeokguk.name).not.toBe("분석 실패");
  });
});
