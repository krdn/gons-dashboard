import type { SajuChart, MajorFortune } from "../types";
import type { TriNationYearly } from "../types/yearly";
import { buildYongshinKo } from "../adapters/ko/yongshin";
import { buildYearlyKo } from "../adapters/ko/yearly";
import { buildYongshinCnZiping } from "../adapters/cn-ziping/yongshin";
import { buildYearlyCnZiping } from "../adapters/cn-ziping/yearly";
import { buildYongshinCnMangpai } from "../adapters/cn-mangpai/yongshin";
import { buildYearlyCnMangpai } from "../adapters/cn-mangpai/yearly";
import { buildYongshinJp } from "../adapters/jp/yongshin";
import { buildYearlyJp } from "../adapters/jp/yearly";

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
