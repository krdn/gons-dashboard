import { resolveTrueSolar } from "../time/trueSolar";
import { verifyConsensus } from "../consensus";
import { computeSajuChart } from "../computeSajuChart";
import { computeMajorFortunes } from "../majorFortune";
import { computeShensha } from "../core/shensha";
import { computeInteractions } from "../core/interactions";
import { buildLifetimeKo } from "../adapters/ko/lifetime";
import { buildLifetimeCnZiping } from "../adapters/cn-ziping/lifetime";
import { buildLifetimeCnMangpai } from "../adapters/cn-mangpai/lifetime";
import { buildLifetimeJp } from "../adapters/jp/lifetime";
import { STEMS } from "../hanja";
import type { Branch, Stem } from "../hanja";
import type { MajorFortune } from "../types";
import type {
  Conflict,
  ExtendedChart,
  LifetimeFrame,
  Result,
  School,
  TriNationLifetime,
  TrueSolarMeta,
} from "../core/extendedTypes";

/** buildTriNationLifetime 입력 — 출생 정보 + 성별. */
export interface BirthInputResolved {
  birthDateLocal: string;
  birthTimeLocal: string;
  timezone: string;
  longitudeDeg: number;
  calendar: "solar" | "lunar";
  gender: "male" | "female";
}

/**
 * 양간(陽干): 甲丙戊庚壬 (index 짝수), 음간(陰干): 乙丁己辛癸 (index 홀수).
 *
 * 명리학 규칙:
 * - 양간 + 男 → 순행(forward)
 * - 양간 + 女 → 역행(backward)
 * - 음간 + 男 → 역행(backward)
 * - 음간 + 女 → 순행(forward)
 */
export function deriveDaeunDirection(yearStem: Stem, gender: "male" | "female"): "forward" | "backward" {
  const stemIndex = STEMS.indexOf(yearStem);
  const isYang = stemIndex % 2 === 0;
  const forwardConditions = (isYang && gender === "male") || (!isYang && gender === "female");
  return forwardConditions ? "forward" : "backward";
}

function consensusToError(libA: { stem: string; branch: string }, libB: { stem: string; branch: string }) {
  return {
    code: "LIBRARY_MISMATCH" as const,
    message: "만세력 라이브러리 결과 불일치",
    details: { libA, libB },
  };
}

function safeFrame(fn: () => LifetimeFrame, school: School): LifetimeFrame {
  try {
    return fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      school,
      pillarsAnnotated: [],
      formatGyeokguk: { name: "분석 실패", reasoning: message },
      yongshin: undefined,
      daeunHighlights: [],
      careerHints: [],
      relationshipHints: [],
      healthHints: [],
      cautions: ["이 학파 분석에 실패했습니다."],
      schoolSpecific: { error: message },
    };
  }
}

/**
 * Phase 5 compose — 4 학파 어댑터 통합 + 만세력 합의 검증 + crossCheck.
 *
 * 입력은 `BirthInputResolved`(생일/생시/타임존/경도/달력/성별). 출력은 `Result<TriNationLifetime>`
 * — 만세력 라이브러리 불일치 시 `error.code = "LIBRARY_MISMATCH"`. 그 외 어댑터별 예외는
 * `safe()` 폴백으로 흡수해 4 frame 항상 노출 (single-school failure 가 전체 응답을 막지 않음).
 *
 * 설계 결정:
 * - **sync 함수**: 하부 모듈(resolveTrueSolar/verifyConsensus/computeSajuChart/어댑터 4종) 모두
 *   sync. async 래핑은 불필요 — KISS.
 * - **`TriNationLifetime.chart` = `ExtendedChart` 4 필드만**: plan 의 chart spread 패턴은
 *   typed contract 위배. shensha/interactions/trueSolarMinutesOffset/hourAmbiguity 만 구성.
 *   Phase 6 API serialization 단계에서 raw chart(pillars/elements/...) 노출 필요 시 별도 필드 추가.
 * - **daeun.direction**: `computeMajorFortunes` 가 direction 을 반환하지 않으므로 연간 stem 양음
 *   + 성별로 derive (`daeun/extended.test.ts` 의 "음년(丁未) 男 → 역행" 규칙 일치).
 * - **yongshinConflicts**: v0.1 의 4 어댑터 모두 `yongshin: undefined` (3개 학파는 미구현,
 *   jp 학파는 본래 미사용) → trivial 빈 배열. Phase 6+ 어댑터 본격 구현 시 실 비교 필요.
 * - **pillarsAgree**: v0.1 의 4 어댑터 모두 `pillarsAnnotated: []` (미구현) → trivial true.
 *   Phase 6+ 어댑터 본격 구현 시 실 비교 필요.
 *
 * @throws verifyConsensus 내부에서 throw 발생 가능 (예: lunar calendar 입력 처리 중). LIBRARY_MISMATCH는 throw 가 아닌 Result.error로 반환된다.
 */
export function buildTriNationLifetime(input: BirthInputResolved): Result<TriNationLifetime> {
  // 1) 진태양시 보정 + 시주 ambiguity 감지
  const trueSolar = resolveTrueSolar(input);

  // 2) 만세력 합의 검증 — 두 라이브러리 일주 비교
  const consensus = verifyConsensus({
    birthDateLocal: input.birthDateLocal,
    calendar: input.calendar,
  });
  if (!consensus.ok) {
    return { ok: false, error: consensusToError(consensus.libA, consensus.libB) };
  }

  // 3) chart + 대운
  const chart = computeSajuChart({
    birthDate: input.birthDateLocal,
    birthTime: input.birthTimeLocal,
    calendar: input.calendar,
    gender: input.gender,
    birthCity: null,
  });
  const daeunRaw: MajorFortune[] = computeMajorFortunes({
    birthDate: input.birthDateLocal,
    birthTime: input.birthTimeLocal,
    calendar: input.calendar,
    gender: input.gender,
  });

  // 4) 신살 + 합충형
  const shensha = computeShensha(chart.pillars);
  const interactions = computeInteractions(chart.pillars);

  // 5) ExtendedChart 4 필드 구성 (spread 금지 — typed contract 준수)
  // NOTE: trueSolar.ambiguityWindow.candidateBranches 는 string[] 로 선언돼 있으나
  //       값은 HOUR_BRANCHES literal 에서 옴 → Branch 로 안전 cast.
  const extendedChart: ExtendedChart = {
    shensha,
    interactions,
    trueSolarMinutesOffset: trueSolar.trueSolarMinutesOffset,
    ...(trueSolar.ambiguityWindow
      ? {
          hourAmbiguity: {
            boundaryHour: trueSolar.ambiguityWindow.boundaryHour,
            candidateBranches: trueSolar.ambiguityWindow.candidateBranches as [Branch, Branch],
          },
        }
      : {}),
  };

  // 6) daeun shape 변환: MajorFortune[] 메타만 추출 ({ startAge, direction }).
  //    pillar 배열은 rawChart.majorFortunes 가 단일 소스 — 직렬화 중복 제거.
  const direction = deriveDaeunDirection(chart.pillars.year.stem, input.gender);
  const daeun: TriNationLifetime["daeun"] = {
    startAge: daeunRaw[0]?.startAge ?? 0,
    direction,
  };

  // 7) 4 학파 어댑터 호출 (safe 폴백 — 단일 어댑터 실패가 전체를 막지 않음)
  // Readonly: 어댑터가 ctx 객체를 mutate 하지 못하도록 컴파일 타임 보호.
  const ctxShared: Readonly<{ daeun: MajorFortune[]; trueSolar: TrueSolarMeta }> = {
    daeun: daeunRaw,
    trueSolar: { trueSolarMinutesOffset: trueSolar.trueSolarMinutesOffset, hourKnown: trueSolar.hourKnown },
  };
  const frames = {
    ko: safeFrame(() => buildLifetimeKo(chart, ctxShared), "ko"),
    cnZiping: safeFrame(() => buildLifetimeCnZiping(chart, ctxShared), "cn-ziping"),
    cnMangpai: safeFrame(() => buildLifetimeCnMangpai(chart, ctxShared), "cn-mangpai"),
    jp: safeFrame(() => buildLifetimeJp(chart, ctxShared), "jp"),
  };

  // 8) crossCheck 산출
  const gyeokgukSchools: Partial<Record<School, string>> = {
    ko: frames.ko.formatGyeokguk.name,
    "cn-ziping": frames.cnZiping.formatGyeokguk.name,
    "cn-mangpai": frames.cnMangpai.formatGyeokguk.name,
    jp: frames.jp.formatGyeokguk.name,
  };
  const gyeokgukConsensus = new Set(Object.values(gyeokgukSchools)).size === 1;

  // TODO(phase-6): 학파별 yongshin 추론 도입 후 4 학파 간 conflict 실측 산출
  // v0.1: 4 어댑터 모두 yongshin: undefined → 비교 대상 없음 → 빈 배열.
  const yongshinConflicts: Conflict[] = [];

  return {
    ok: true,
    value: {
      chart: extendedChart,
      rawChart: chart,
      daeun,
      trueSolar: {
        trueSolarMinutesOffset: trueSolar.trueSolarMinutesOffset,
        hourKnown: trueSolar.hourKnown,
      },
      frames,
      crossCheck: {
        // TODO(phase-6): 4 학파 pillars 등가성 검증 함수 도입 (현재는 어댑터 pillarsAnnotated 미구현 — trivially true)
        pillarsAgree: true,
        gyeokgukConsensus: { consensus: gyeokgukConsensus, schools: gyeokgukSchools },
        // TODO(phase-6): 학파별 yongshin 추론 도입 후 실 충돌 검출 (v0.1 어댑터 모두 yongshin undefined)
        yongshinConflicts,
      },
    },
  };
}
