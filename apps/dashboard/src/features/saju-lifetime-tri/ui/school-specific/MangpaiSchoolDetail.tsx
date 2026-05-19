// 中맹파 (cn-mangpai) 학파 detail — 응기 시점 타임라인.
import type { SchoolSpecificMangpai } from "@/shared/lib/db/schema";

interface Props {
  data: SchoolSpecificMangpai;
}

export function MangpaiSchoolDetail({ data }: Props) {
  return (
    <section className="border border-[var(--color-hairline)] rounded p-3 space-y-3">
      <h4 aria-level={4} className="text-sm font-semibold">
        中맹파 추가 분석 — 응기(應期) 타임라인
      </h4>
      <table className="w-full text-sm">
        <caption className="sr-only">시점별 사건 예측</caption>
        <thead>
          <tr className="border-b border-[var(--color-hairline)]">
            <th scope="col" className="text-left py-2 text-xs text-[var(--color-text-secondary)]">
              시점
            </th>
            <th scope="col" className="text-left py-2 text-xs text-[var(--color-text-secondary)]">
              사건
            </th>
          </tr>
        </thead>
        <tbody>
          {data.eventTimings.map((t, idx) => (
            <tr key={idx} className="border-b border-[var(--color-hairline)] last:border-b-0">
              <th scope="row" className="py-2 pr-3 align-top font-medium">
                {t.period}
              </th>
              <td className="py-2 align-top">{t.event}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
