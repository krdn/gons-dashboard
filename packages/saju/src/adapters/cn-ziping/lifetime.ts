import type { SajuChart, MajorFortune } from "../../types";
import type { LifetimeFrame, TrueSolarMeta } from "../../core/extendedTypes";

/**
 * 중국 자평(子平) — 자평진전(子平眞詮) + 적천수(滴天髓) 혼합 단순화 — v0.1 시드.
 *
 * 자평진전 계열은 월령(月令) 격국을 우선 본 뒤 천간 투출(透出)로 격을 확정한다.
 * 적천수는 신강·신약(身強·身弱) 균형 분석과 억부(抑扶) 용신 도출에 강점. v0.1
 * 시드에서는 두 학파의 격국·용신법을 혼합 의도로 선언만 하고, 실제 yongshin
 * 값은 미구현 상태 — `schoolSpecific.yongshinMethod: "억부"` 와 `yongshin: undefined`
 * 가 모순 상태로 노출된다.
 *
 * TODO(v0.2): yongshin 값 미구현. `yongshinMethod: "억부"` 선언만 있고 실제
 * 억부 알고리즘(신강·신약 판정 + 보조 오행 도출) 은 v0.2 에서 구현 예정.
 * Phase 5 compose 단계의 `yongshinConflicts` 산출 시 silent gap 발생 가능
 * (cn-mangpai 와 동일 패턴) — cautions 에 명시한다.
 *
 * @param chart 본명 사주 차트.
 * @param _ctx Phase 4 공통 시그니처용 컨텍스트 — cn-ziping 학파는 미사용 (시드 v0.1).
 */
export function buildLifetimeCnZiping(
  chart: SajuChart,
  _ctx?: { daeun?: MajorFortune[]; trueSolar?: TrueSolarMeta },
): LifetimeFrame {
  const gyeokguk = chart.pattern || "미확정";

  return {
    school: "cn-ziping",
    pillarsAnnotated: [],
    formatGyeokguk: {
      name: gyeokguk,
      reasoning: `자평진전 — 월지 격국 + 천간 투출 (${gyeokguk})`,
    },
    yongshin: undefined,
    daeunHighlights: [],
    careerHints: ["전문직·자영업·기술 — 격국 따라 재성 활용"],
    relationshipHints: ["격국 호환 — 용신 동조 파트너"],
    healthHints: ["적천수 억부 — 신강·신약 균형, 부족한 오행이 약한 장부"],
    cautions: [
      "격국이 깨지는 대운(파격·破格)에 큰 변동 주의",
      "v0.1: yongshinMethod 선언만, yongshin 값 미구현 — Phase 5 silent gap 주의",
    ],
    schoolSpecific: {
      gyeokgukOrigin: "자평진전",
      yongshinMethod: "억부",
      system: "자평진전",
    },
  };
}
