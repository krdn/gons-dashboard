import type { SajuChart } from "../../types";
import type { Element } from "../../hanja";
import { STEM_ELEMENT, BRANCH_ELEMENT } from "../../hanja";
import type { KoYongshin } from "../../types/yongshin";
import type { DailyLiteFrame } from "../../types/daily-tri";
import { computeDayPillar } from "../../dayPillar";

/**
 * 한국식 일진 어댑터 — 일진 간지 vs 용신 (primary + secondary + 종격 cascade) 비교.
 *
 * spec D6 단순화: yongShinDelta/ganjiInteractions 구조 미생성, dayVibe (3분류) + hints
 * (LLM 프롬프트용 문자열) 만 출력.
 *
 * 평가 로직:
 *  - dayStem/dayBranch 의 오행을 추출
 *  - 둘 다 primary/secondary/xishen 중 하나면 auspicious
 *  - 둘 다 gisin 이면 inauspicious
 *  - 그 외 (mixed 포함) neutral
 */
export function buildDailyLiteKo(args: {
  chart: SajuChart;
  forDate: string;
  yongShin: KoYongshin;
}): DailyLiteFrame {
  const { forDate, yongShin } = args;
  const dayPillar = computeDayPillar(forDate);
  const dayStemEl = STEM_ELEMENT[dayPillar.stem];
  const dayBranchEl = BRANCH_ELEMENT[dayPillar.branch];

  // 종격 cascade — 종아/종재/종살격은 primary 다음 흐름도 喜神 (yearly 와 동일 규칙)
  const PRODUCES: Record<Element, Element> = {
    wood: "fire", fire: "earth", earth: "metal", metal: "water", water: "wood",
  };
  const isJonggyeok =
    yongShin.basisShenStrength === "종아" ||
    yongShin.basisShenStrength === "종재" ||
    yongShin.basisShenStrength === "종살";
  const xishen: Element | null = isJonggyeok ? PRODUCES[yongShin.primary] : null;

  const goodSet = new Set<Element>([
    yongShin.primary,
    ...(yongShin.secondary ? [yongShin.secondary] : []),
    ...(xishen ? [xishen] : []),
  ]);
  const gisinSet = new Set<Element>(yongShin.gisin);

  const dayEls: Element[] = [dayStemEl, dayBranchEl];
  const goodHits = dayEls.filter((e) => goodSet.has(e)).length;
  const badHits = dayEls.filter((e) => gisinSet.has(e)).length;

  let dayVibe: DailyLiteFrame["dayVibe"];
  if (goodHits >= 2 && badHits === 0) dayVibe = "auspicious";
  else if (badHits >= 2 && goodHits === 0) dayVibe = "inauspicious";
  else dayVibe = "neutral";

  const hints: string[] = [];
  hints.push(
    `일진 ${dayPillar.stem}${dayPillar.branch} — 천간 오행 ${dayStemEl}, 지지 오행 ${dayBranchEl}`,
  );
  if (goodHits > 0) {
    hints.push(
      `용신 ${yongShin.primary}${yongShin.secondary ? `+${yongShin.secondary}` : ""} 보강 ${goodHits}건`,
    );
  }
  if (badHits > 0) {
    hints.push(`기신 ${yongShin.gisin.join("·")} 자극 ${badHits}건`);
  }
  if (yongShin.basisJohuMode) {
    hints.push(`조후 기준: ${yongShin.basisJohuMode}`);
  }

  return {
    school: "ko",
    forDate,
    dayGanji: { stem: dayPillar.stem, branch: dayPillar.branch },
    dayVibe,
    hints,
  };
}
