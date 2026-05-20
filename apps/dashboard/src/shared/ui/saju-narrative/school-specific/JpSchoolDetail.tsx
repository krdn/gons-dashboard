// 日추명 (jp) 학파 detail — 12궁 처세.
import type { SchoolSpecificJp } from "@/shared/lib/db/schema";

interface Props {
  data: SchoolSpecificJp;
}

export function JpSchoolDetail({ data }: Props) {
  return (
    <section className="border border-[var(--color-hairline)] rounded p-3 space-y-3">
      <h4 aria-level={4} className="text-sm font-semibold">
        日추명 추가 분석 — 12궁 처세
      </h4>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {data.palaceMap.map((p, idx) => (
          <div
            key={idx}
            className="border-l-2 border-[var(--color-hairline)] pl-2"
          >
            <dt className="text-xs font-semibold mb-1">{p.palace}</dt>
            <dd className="text-sm leading-relaxed">{p.note}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
