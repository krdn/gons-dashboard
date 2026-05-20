// 한국식 (ko) 학파 detail — 조후 + 신살.
import type { SchoolSpecificKo } from "@/shared/lib/db/schema";

interface Props {
  data: SchoolSpecificKo;
}

export function KoSchoolDetail({ data }: Props) {
  return (
    <section className="border border-[var(--color-hairline)] rounded p-3 space-y-3">
      <h4 aria-level={4} className="text-sm font-semibold">
        한국식 추가 분석 — 조후·신살
      </h4>
      <dl className="space-y-2">
        <div>
          <dt className="text-xs text-[var(--color-text-secondary)] mb-1">
            조후 포커스
          </dt>
          <dd className="text-sm leading-relaxed">{data.joohuFocus}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-text-secondary)] mb-1">
            신살 해석
          </dt>
          <dd>
            <ul className="space-y-1">
              {data.shinsalNotes.map((note, idx) => (
                <li key={idx} className="text-sm leading-relaxed">
                  · {note}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
    </section>
  );
}
