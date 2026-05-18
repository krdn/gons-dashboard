import type { SajuChart, MajorFortune } from "../types";
import type { TriNationYearly } from "../types/yearly";
import type { Result } from "../core/extendedTypes";
import { resolveTrueSolar } from "../time/trueSolar";
import { verifyConsensus } from "../consensus";
import { computeSajuChart } from "../computeSajuChart";
import { computeMajorFortunes } from "../majorFortune";
import { buildYongshinKo } from "../adapters/ko/yongshin";
import { buildYearlyKo } from "../adapters/ko/yearly";
import { buildYongshinCnZiping } from "../adapters/cn-ziping/yongshin";
import { buildYearlyCnZiping } from "../adapters/cn-ziping/yearly";
import { buildYongshinCnMangpai } from "../adapters/cn-mangpai/yongshin";
import { buildYearlyCnMangpai } from "../adapters/cn-mangpai/yearly";
import { buildYongshinJp } from "../adapters/jp/yongshin";
import { buildYearlyJp } from "../adapters/jp/yearly";
import type { BirthInputResolved } from "./lifetime";

function evaluateAgreement(frames: TriNationYearly["frames"]): {
  agreement: "high" | "medium" | "low";
  notes: string[];
} {
  // 결정형 학파 3개(KO, CN자평, CN맹파)의 netVerdict 만 집계 — JP 는 항상 mixed.
  const verdicts = [
    frames.ko.yongShinDelta.netVerdict,
    frames.cnZiping.yongShinDelta.netVerdict,
    frames.cnMangpai.yongShinDelta.netVerdict,
  ];
  const favorableCount = verdicts.filter((v) => v === "favorable").length;
  const unfavorableCount = verdicts.filter((v) => v === "unfavorable").length;

  const notes: string[] = [];
  if (favorableCount === 3) {
    notes.push("KO·CN자평·CN맹파 3학파가 favorable 합의");
    return { agreement: "high", notes };
  }
  if (unfavorableCount === 3) {
    notes.push("KO·CN자평·CN맹파 3학파가 unfavorable 합의");
    return { agreement: "high", notes };
  }
  if (favorableCount === 2 || unfavorableCount === 2) {
    notes.push(`3학파 중 2학파 동의 (favorable=${favorableCount}, unfavorable=${unfavorableCount})`);
    return { agreement: "medium", notes };
  }
  notes.push("학파별 판단 분기 — LLM narrative 로 학파별 입장 확인 권장");
  return { agreement: "low", notes };
}

export function buildTriNationYearly(args: {
  chart: SajuChart;
  daeun: MajorFortune[];
  targetYear: number;
  currentAge: number;
}): TriNationYearly {
  const { chart, daeun, targetYear, currentAge } = args;

  const yongKo = buildYongshinKo(chart);
  const yongCz = buildYongshinCnZiping(chart);
  const yongCm = buildYongshinCnMangpai(chart);
  const yongJp = buildYongshinJp(chart);

  const frames: TriNationYearly["frames"] = {
    ko: buildYearlyKo({ chart, daeun, targetYear, yongShin: yongKo, currentAge }),
    cnZiping: buildYearlyCnZiping({ chart, daeun, targetYear, yongShin: yongCz, currentAge }),
    cnMangpai: buildYearlyCnMangpai({ chart, daeun, targetYear, yongShin: yongCm, currentAge }),
    jp: buildYearlyJp({ chart, daeun, targetYear, yongShin: yongJp, currentAge }),
  };

  return {
    targetYear,
    frames,
    crossCheck: evaluateAgreement(frames),
  };
}

/**
 * v0.2 Phase 4 — BirthInputResolved 입력만으로 TriNationYearly 를 빌드하는 wrapper.
 *
 * lifetime 빌더의 step 1~3 (resolveTrueSolar → verifyConsensus → computeSajuChart +
 * computeMajorFortunes) 을 미러링한다. 합의 불일치 시 동일한 `LIBRARY_MISMATCH`
 * 코드로 Result.error 반환 → dashboard 라우트가 v0.1 과 같은 422 매핑 가능.
 *
 * `consensusToError` 로직은 lifetime.ts 와 의도적 코드 복제 — Phase 3 결정사항
 * "학파별 룰 차이 가능성" 일관성 유지 + 모듈 간 private 의존 회피.
 */
export function buildTriNationYearlyFromBirth(args: {
  input: BirthInputResolved;
  targetYear: number;
  currentAge: number;
}): Result<TriNationYearly> {
  const { input, targetYear, currentAge } = args;

  // 1) 진태양시 보정 (yearly 는 ambiguityWindow 직접 사용하지 않지만 consensus 와 동일
  //    lifetime 패턴 유지 — 추후 보정 적용 시 한 곳에서 일관 처리).
  resolveTrueSolar(input);

  // 2) 만세력 합의 검증 — 두 라이브러리 일주 비교
  const consensus = verifyConsensus({
    birthDateLocal: input.birthDateLocal,
    calendar: input.calendar,
  });
  if (!consensus.ok) {
    return {
      ok: false,
      error: {
        code: "LIBRARY_MISMATCH",
        message: "만세력 라이브러리 결과 불일치",
        details: { libA: consensus.libA, libB: consensus.libB },
      },
    };
  }

  // 3) chart + 대운
  const chart: SajuChart = computeSajuChart({
    birthDate: input.birthDateLocal,
    birthTime: input.birthTimeLocal,
    calendar: input.calendar,
    gender: input.gender,
    birthCity: null,
  });
  const daeun: MajorFortune[] = computeMajorFortunes({
    birthDate: input.birthDateLocal,
    birthTime: input.birthTimeLocal,
    calendar: input.calendar,
    gender: input.gender,
  });

  // 4) TriNationYearly compose
  return {
    ok: true,
    value: buildTriNationYearly({ chart, daeun, targetYear, currentAge }),
  };
}
