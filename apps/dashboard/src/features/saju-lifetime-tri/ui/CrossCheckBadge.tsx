// 4기둥 합의 / 격국 합의 / 진태양시 보정 / 시주 모호성 표시 (server-safe — no client hooks).
//
// chart.hourAmbiguity 는 TriNationLifetime.chart (ExtendedChart) 의 optional 필드.
// trueSolar.trueSolarMinutesOffset 은 TrueSolarMeta 의 필수 필드.
// crossCheck.pillarsAgree / gyeokgukConsensus.{consensus, schools} 는 모두 buildTriNationLifetime
// (packages/saju/src/compose/lifetime.ts) 에서 보장된 shape.
import type { TriNationLifetime } from "@gons/saju";

interface Props {
  triNation: TriNationLifetime;
}

export function CrossCheckBadge({ triNation }: Props) {
  const { chart, trueSolar, crossCheck } = triNation;
  const schoolsLine = Object.entries(crossCheck.gyeokgukConsensus.schools)
    .map(([school, name]) => `${school}=${name}`)
    .join(", ");

  return (
    <div className="border rounded p-3 bg-slate-50 text-sm space-y-1">
      <div>{crossCheck.pillarsAgree ? "✓" : "⚠"} 4기둥 합의 검증 통과</div>
      <div>
        {crossCheck.gyeokgukConsensus.consensus ? "✓" : "⚠"} 격국: {schoolsLine}
      </div>
      <div>ⓘ 진태양시 보정 {trueSolar.trueSolarMinutesOffset}분</div>
      {chart.hourAmbiguity && (
        <div>
          ⚠ 시주 모호성 ±5분 — 후보 {chart.hourAmbiguity.candidateBranches.join(" / ")}
        </div>
      )}
    </div>
  );
}
