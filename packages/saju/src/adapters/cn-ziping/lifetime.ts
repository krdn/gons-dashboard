import type { SajuChart } from "../../types";
import type { LifetimeFrame } from "../../core/extendedTypes";

export function buildLifetimeCnZiping(chart: SajuChart): LifetimeFrame {
  const gyeokguk = chart.pattern || "未확정";

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
    cautions: ["격국이 깨지는 대운(파격·破格)에 큰 변동 주의"],
    schoolSpecific: { gyeokgukOrigin: "자평진전", yongshinMethod: "억부" },
  };
}
