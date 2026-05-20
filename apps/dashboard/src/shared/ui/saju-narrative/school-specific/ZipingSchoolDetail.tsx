// 중자평 (cn-ziping) 학파 detail — 격국·용신 철학적 근거.
import type { SchoolSpecificZiping } from "@/shared/lib/db/schema";

interface Props {
  data: SchoolSpecificZiping;
}

export function ZipingSchoolDetail({ data }: Props) {
  return (
    <section className="border border-[var(--color-hairline)] rounded p-3 space-y-3">
      <h4 aria-level={4} className="text-sm font-semibold">
        中자평 추가 분석 — 격국·용신
      </h4>
      <dl className="space-y-2">
        <div>
          <dt className="text-xs text-[var(--color-text-secondary)] mb-1">
            격국 성립/파괴 근거
          </dt>
          <dd className="text-sm leading-relaxed whitespace-pre-wrap">
            {data.gyeokgukRationale}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-text-secondary)] mb-1">
            용신 후보 분석
          </dt>
          <dd className="text-sm leading-relaxed whitespace-pre-wrap">
            {data.yongshinAnalysis}
          </dd>
        </div>
      </dl>
    </section>
  );
}
