import type { SajuChart } from "../types";
import type { TriNationDailyLite, DailyLiteFrame } from "../types/daily-tri";
import type { Result } from "../core/extendedTypes";
import { resolveTrueSolar } from "../time/trueSolar";
import { verifyConsensus } from "../consensus";
import { computeSajuChart } from "../computeSajuChart";
import { buildYongshinKo } from "../adapters/ko/yongshin";
import { buildDailyLiteKo } from "../adapters/ko/daily";
import { buildYongshinCnZiping } from "../adapters/cn-ziping/yongshin";
import { buildDailyLiteCnZiping } from "../adapters/cn-ziping/daily";
import { buildYongshinCnMangpai } from "../adapters/cn-mangpai/yongshin";
import { buildDailyLiteCnMangpai } from "../adapters/cn-mangpai/daily";
import { buildYongshinJp } from "../adapters/jp/yongshin";
import { buildDailyLiteJp } from "../adapters/jp/daily";
import type { BirthInputResolved } from "./lifetime";

/**
 * 4학파 dayVibe 의 합의 — 3/4 학파 이상이 같은 값을 내면 그 값, 아니면 "neutral".
 * (jp 는 항상 "neutral" 이라 실질 합의는 ko/cnZiping/cnMangpai 3학파 동의가 핵심.)
 */
function evaluateOverallVibe(
  frames: TriNationDailyLite["frames"],
): TriNationDailyLite["overallVibe"] {
  const vibes: DailyLiteFrame["dayVibe"][] = [
    frames.ko.dayVibe,
    frames.cnZiping.dayVibe,
    frames.cnMangpai.dayVibe,
    frames.jp.dayVibe,
  ];
  const auspiciousCount = vibes.filter((v) => v === "auspicious").length;
  const inauspiciousCount = vibes.filter((v) => v === "inauspicious").length;

  if (auspiciousCount >= 3) return "auspicious";
  if (inauspiciousCount >= 3) return "inauspicious";
  return "neutral";
}

export function buildTriNationDailyLite(args: {
  chart: SajuChart;
  forDate: string;
}): TriNationDailyLite {
  const { chart, forDate } = args;

  const yongKo = buildYongshinKo(chart);
  const yongCz = buildYongshinCnZiping(chart);
  const yongCm = buildYongshinCnMangpai(chart);
  const yongJp = buildYongshinJp(chart);

  const frames: TriNationDailyLite["frames"] = {
    ko: buildDailyLiteKo({ chart, forDate, yongShin: yongKo }),
    cnZiping: buildDailyLiteCnZiping({ chart, forDate, yongShin: yongCz }),
    cnMangpai: buildDailyLiteCnMangpai({ chart, forDate, yongShin: yongCm }),
    jp: buildDailyLiteJp({ chart, forDate, yongShin: yongJp }),
  };

  return {
    forDate,
    frames,
    overallVibe: evaluateOverallVibe(frames),
  };
}

/**
 * v0.3 Phase 4 — BirthInputResolved + forDate 입력만으로 TriNationDailyLite 빌드.
 *
 * yearly/monthly wrapper 와 동일 패턴 (resolveTrueSolar → verifyConsensus → chart →
 * compose). daeun 은 일진 평가에 불필요해 computeMajorFortunes 호출 제거 — 빌드 비용
 * 감소. 합의 불일치 시 LIBRARY_MISMATCH Result.error.
 *
 * 메모리 `saju-yearly-wrapper-pattern` — packages/saju 안에서 wrapper 가 verifyConsensus
 * 를 직접 호출해야 자기모순 방지.
 */
export function buildTriNationDailyLiteFromBirth(args: {
  input: BirthInputResolved;
  forDate: string;
}): Result<TriNationDailyLite> {
  const { input, forDate } = args;

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

  return {
    ok: true,
    value: buildTriNationDailyLite({ chart, forDate }),
  };
}
