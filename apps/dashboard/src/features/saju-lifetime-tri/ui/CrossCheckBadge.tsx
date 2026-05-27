// 4기둥 합의 / 격국 합의 / 진태양시 보정 / 시주 모호성 표시 (server-safe — no client hooks).
//
// chart.hourAmbiguity 는 TriNationLifetime.chart (ExtendedChart) 의 optional 필드.
// trueSolar.trueSolarMinutesOffset 은 TrueSolarMeta 의 필수 필드.
// crossCheck.pillarsAgree / gyeokgukConsensus.{consensus, schools} 는 모두 buildTriNationLifetime
// (packages/saju/src/compose/lifetime.ts) 에서 보장된 shape.
//
// 디자인 토큰: SajuTriLifetime widget 의 sub-block 이므로 --color-hairline +
// --color-surface-2 (부모 --color-surface 보다 한 단계 어두운 톤) 적용.
// 상태별 색상 정책:
//   ✓ 통과 / ⓘ 정보 → --color-text-muted (정상은 침묵)
//   ⚠ 경고          → text-amber-700 (red 까지는 아닌 코드베이스 표준 톤)
import type { TriNationLifetime } from "@krdn/saju";

interface Props {
  triNation: TriNationLifetime;
}

const STATUS_OK = "text-[var(--color-text-muted)]";
const STATUS_INFO = "text-[var(--color-text-muted)]";
const STATUS_WARN = "text-amber-700";

export function CrossCheckBadge({ triNation }: Props) {
  const { chart, trueSolar, crossCheck } = triNation;
  const schoolsLine = Object.entries(crossCheck.gyeokgukConsensus.schools)
    .map(([school, name]) => `${school}=${name}`)
    .join(", ");

  return (
    <div className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface-2)] p-3 text-sm space-y-1">
      <div className={crossCheck.pillarsAgree ? STATUS_OK : STATUS_WARN}>
        {crossCheck.pillarsAgree ? "✓" : "⚠"} 4기둥 합의 검증 통과
      </div>
      <div className={crossCheck.gyeokgukConsensus.consensus ? STATUS_OK : STATUS_WARN}>
        {crossCheck.gyeokgukConsensus.consensus ? "✓" : "⚠"} 격국: {schoolsLine}
      </div>
      <div className={STATUS_INFO}>
        ⓘ 진태양시 보정 {trueSolar.trueSolarMinutesOffset}분
      </div>
      {chart.hourAmbiguity && (
        <div className={STATUS_WARN}>
          ⚠ 시주 모호성 ±5분 — 후보 {chart.hourAmbiguity.candidateBranches.join(" / ")}
        </div>
      )}
    </div>
  );
}
