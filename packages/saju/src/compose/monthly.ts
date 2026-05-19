import type { SajuChart, MajorFortune } from "../types";
import type { TriNationMonthly } from "../types/monthly";
import type { Result } from "../core/extendedTypes";
import { resolveTrueSolar } from "../time/trueSolar";
import { verifyConsensus } from "../consensus";
import { computeSajuChart } from "../computeSajuChart";
import { computeMajorFortunes } from "../majorFortune";
import { buildYongshinKo } from "../adapters/ko/yongshin";
import { buildMonthlyKo } from "../adapters/ko/monthly";
import { buildYongshinCnZiping } from "../adapters/cn-ziping/yongshin";
import { buildMonthlyCnZiping } from "../adapters/cn-ziping/monthly";
import { buildYongshinCnMangpai } from "../adapters/cn-mangpai/yongshin";
import { buildMonthlyCnMangpai } from "../adapters/cn-mangpai/monthly";
import { buildYongshinJp } from "../adapters/jp/yongshin";
import { buildMonthlyJp } from "../adapters/jp/monthly";
import type { BirthInputResolved } from "./lifetime";

function evaluateAgreement(frames: TriNationMonthly["frames"]): {
  agreement: "high" | "medium" | "low";
  notes: string[];
} {
  // yearly evaluateAgreement 와 동일 로직 — 결정형 학파 3개의 netVerdict 합의.
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

export function buildTriNationMonthly(args: {
  chart: SajuChart;
  daeun: MajorFortune[];
  targetYear: number;
  targetMonth: number;
  currentAge: number;
}): TriNationMonthly {
  const { chart, daeun, targetYear, targetMonth, currentAge } = args;

  const yongKo = buildYongshinKo(chart);
  const yongCz = buildYongshinCnZiping(chart);
  const yongCm = buildYongshinCnMangpai(chart);
  const yongJp = buildYongshinJp(chart);

  const frames: TriNationMonthly["frames"] = {
    ko: buildMonthlyKo({ chart, daeun, targetYear, targetMonth, yongShin: yongKo, currentAge }),
    cnZiping: buildMonthlyCnZiping({ chart, daeun, targetYear, targetMonth, yongShin: yongCz, currentAge }),
    cnMangpai: buildMonthlyCnMangpai({ chart, daeun, targetYear, targetMonth, yongShin: yongCm, currentAge }),
    jp: buildMonthlyJp({ chart, daeun, targetYear, targetMonth, yongShin: yongJp, currentAge }),
  };

  return {
    targetYear,
    targetMonth,
    frames,
    crossCheck: evaluateAgreement(frames),
  };
}

/**
 * v0.3 Phase 2 — BirthInputResolved 입력만으로 TriNationMonthly 를 빌드하는 wrapper.
 *
 * yearly wrapper 와 동일 패턴 (resolveTrueSolar → verifyConsensus → chart+daeun → compose).
 * 합의 불일치 시 `LIBRARY_MISMATCH` Result.error 반환 → dashboard 라우트가 422 매핑 가능.
 *
 * 메모리 `saju-yearly-wrapper-pattern` 적용 — packages/saju 내부 wrapper 필수.
 */
export function buildTriNationMonthlyFromBirth(args: {
  input: BirthInputResolved;
  targetYear: number;
  targetMonth: number;
  currentAge: number;
}): Result<TriNationMonthly> {
  const { input, targetYear, targetMonth, currentAge } = args;

  resolveTrueSolar(input);

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

  return {
    ok: true,
    value: buildTriNationMonthly({ chart, daeun, targetYear, targetMonth, currentAge }),
  };
}
