import type { SajuChart, MajorFortune } from "../../types";
import type { LifetimeFrame, TrueSolarMeta } from "../../core/extendedTypes";

/**
 * 일본 추명학(推命学) 단순화 — v0.1 시드.
 *
 * 아베 다이잔(阿部泰山) 계열을 중심으로 한 일본식 추명학은 통변성 분포와
 * 12궁(年宮·月宮·日宮·時宮 + 부부·자녀 등) 매핑을 통해 인생 흐름을 본다.
 * 진태양시(真太陽時) 보정에 매우 민감하므로 `ctx.trueSolar` 메타로 정확도를 표기.
 *
 * NOTE: 일본 추명학은 용신(用神) 개념을 사용하지 않는다 — `yongshin: undefined`
 * 는 의도적 omit (extendedTypes.ts 명시 사양). cn-mangpai·cn-ziping 의 v0.1
 * 미적용 TODO 와 의미가 다르므로 `cautions` 에 별도 yongshin 미적용 표기를
 * 하지 않는다. Phase 5 compose 단계의 `yongshinConflicts` 산출 시 silent skip
 * 대상.
 *
 * `_chart` 는 v0.1 시드에서 미사용 — 언더스코어 prefix 로 의도 표기. v0.2 이후
 * 통변성 분포·12궁 매핑 본격 구현 시 활용 예정.
 *
 * @param _chart 본명 사주 차트 (v0.1 미사용).
 * @param ctx Phase 4 공통 시그니처 — `ctx.trueSolar` 로 진태양시 정확도 표기. 누락 시 "진태양시 미상" 폴백.
 */
export function buildLifetimeJp(
  _chart: SajuChart,
  ctx?: { daeun?: MajorFortune[]; trueSolar?: TrueSolarMeta },
): LifetimeFrame {
  const trueSolar = ctx?.trueSolar;
  let accuracy: string;
  if (!trueSolar) {
    accuracy = "진태양시 미상 — 추명학 정확도 ⚠";
  } else if (trueSolar.hourKnown) {
    accuracy = `진태양시 보정 ${trueSolar.trueSolarMinutesOffset}분 — 시주 신뢰 가능`;
  } else {
    accuracy = "시주 미상 — 추명학 정확도 ⚠";
  }

  return {
    school: "jp",
    pillarsAnnotated: [],
    formatGyeokguk: { name: "추명학은 격국 단순화", reasoning: "통변성 + 12궁 중심" },
    yongshin: undefined,
    daeunHighlights: [],
    careerHints: ["일본 처세 — 통변성 분포 기준"],
    relationshipHints: ["12궁 — 부부궁·자녀궁 분리"],
    healthHints: ["오장육부 매핑 = 통변성"],
    cautions: ["학파 다양성·심도 낮음 — 보조 관점"],
    schoolSpecific: { accuracy, system: "아베 다이잔 추명학 단순화" },
  };
}
