import type { SajuChart, MajorFortune } from "../../types";
import type { LifetimeFrame, TrueSolarMeta } from "../../core/extendedTypes";

/**
 * 한국식 자평(子平) + 조후(調候) + 신살(神煞) 단순화 — v0.1 시드.
 *
 * 한국 명리는 자평진전의 격국 체계를 기반으로, 한반도 사주학 특유의 조후·신살
 * 관점을 가미한다. 월령 기반 격국을 따라 `chart.pattern` 값을 그대로 노출하고,
 * 봄·여름·가을·겨울 절기 조후로 healthHints 를 도출하는 게 본 학파의 시그니처.
 *
 * NOTE(한계): healthHints 는 1967-03-29 fixture(卯月·木旺·水강) 에 강결합된
 * 시드 문구이며 v0.1 에서는 차트별 일반화가 되어있지 않다. Phase 5 compose
 * 단계에서 chart 의 월령·오행 분포 기반으로 동적 도출 예정.
 *
 * TODO(v0.2): yongshin 미구현 — 한국식 억부·조후 혼합 용신 계산 v0.2 적용
 * 예정. compose 단계의 yongshinConflicts 산출 시 silent skip 대상이 되므로
 * cautions 에 명시한다.
 *
 * @param chart 본명 사주 차트.
 * @param _ctx Phase 4 공통 시그니처용 컨텍스트 — ko 학파는 미사용 (시드 v0.1).
 */
export function buildLifetimeKo(
  chart: SajuChart,
  _ctx?: { daeun?: MajorFortune[]; trueSolar?: TrueSolarMeta },
): LifetimeFrame {
  const gyeokguk = chart.pattern || "미확정";

  return {
    school: "ko",
    pillarsAnnotated: [],
    formatGyeokguk: {
      name: gyeokguk,
      reasoning: `한국식 자평+조후 — 월지 기반 격국 ${gyeokguk}`,
    },
    yongshin: undefined,
    daeunHighlights: [],
    careerHints: ["연구·전략기획·교육·자영업"],
    relationshipHints: ["지적·깊이 있는 대화 통하는 파트너"],
    healthHints: ["봄 卯月 출생, 木旺·水강 — 신장·하체 순환 + 火土 보강"],
    cautions: [
      "신살: 괴강·도화 — 자존심 과·표현 직설 주의",
      "v0.1: 용신(yongshin) 미적용 — 한국식 억부·조후 혼합 용신 v0.2 적용 예정",
    ],
    schoolSpecific: {
      method: "한국식 자평+조후+신살",
      system: "한국식 자평",
    },
  };
}
