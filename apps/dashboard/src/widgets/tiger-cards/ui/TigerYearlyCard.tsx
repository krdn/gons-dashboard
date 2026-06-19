"use client";

import { TigerNarrative } from "@/entities/tiger-reading";
import type { PlayMCPYearlyResult } from "@/entities/tiger-reading";

interface Props {
  payload: PlayMCPYearlyResult;
  year: number;
  availableYears: number[];
  selectedYear: number;
  onYearChange: (year: number) => void;
}

export function TigerYearlyCard({
  payload, year, availableYears, selectedYear, onYearChange,
}: Props) {
  const r = payload.result;
  const tone = gradeTone(r.grade_ko);
  return (
    <article className="rounded-xl border bg-white p-6 shadow-sm">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🐯</span>
          <div>
            <h2 className="text-lg font-semibold">신년 인사이트</h2>
            <p className="text-sm text-gray-600">
              {year}년 · 한국나이 {r.korean_age}세
            </p>
          </div>
        </div>
        <select
          value={selectedYear}
          onChange={(e) => onYearChange(Number(e.target.value))}
          className="rounded border px-2 py-1 text-sm"
          aria-label="연도 선택"
        >
          {availableYears.map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
      </header>

      <section className={`mb-5 rounded-lg border p-4 ${tone.surface}`}>
        <div className="mb-2 flex items-baseline gap-3">
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${tone.badge}`}>
            {r.grade_ko}
          </span>
          <span className={`text-sm font-medium ${tone.text}`}>{r.one_line_ko}</span>
        </div>
        <p className={`text-sm ${tone.text}`}>{r.year_overview_ko}</p>
      </section>

      <section className="mb-5">
        <h3 className="mb-2 text-sm font-semibold text-gray-700">올해의 키워드</h3>
        <ul className="flex flex-wrap gap-2">
          {r.key_themes_ko.map((theme, idx) => (
            <li
              key={idx}
              className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900"
            >
              {theme}
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <BulletList
          label="기회 요소"
          items={r.opportunities_ko}
          itemClass="border-green-200 bg-green-50 text-green-900"
        />
        <BulletList
          label="주의 사항"
          items={r.cautions_ko}
          itemClass="border-red-200 bg-red-50 text-red-900"
        />
      </section>

      <section className="mb-5 rounded border bg-indigo-50 p-4">
        <h3 className="mb-1 text-sm font-semibold text-indigo-900">
          대운 {r.daeun_detail.gapja} ({r.daeun_detail.age_range_ko})
        </h3>
        <p className="text-sm text-indigo-900">{r.daeun_detail.summary_ko}</p>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">호(虎)의 풀이</h3>
        <TigerNarrative narrative={r.suggested_narrative_ko} />
      </section>
    </article>
  );
}

function BulletList({
  label,
  items,
  itemClass,
}: {
  label: string;
  items: string[];
  itemClass: string;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500">—</p>
      ) : (
        <ul className="space-y-1">
          {items.map((it, idx) => (
            <li key={idx} className={`rounded border px-2 py-1 text-xs ${itemClass}`}>
              {it}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function gradeTone(grade: string): { surface: string; badge: string; text: string } {
  // 흉/소흉: 빨강, 평/평길: 회색, 길/대길: 초록
  if (grade.includes("대길") || grade.includes("길") || grade.startsWith("吉")) {
    return {
      surface: "border-green-200 bg-green-50",
      badge: "bg-green-100 text-green-900",
      text: "text-green-900",
    };
  }
  if (grade.includes("흉") || grade.startsWith("凶")) {
    return {
      surface: "border-red-200 bg-red-50",
      badge: "bg-red-100 text-red-900",
      text: "text-red-900",
    };
  }
  return {
    surface: "border-gray-200 bg-gray-50",
    badge: "bg-gray-100 text-gray-900",
    text: "text-gray-900",
  };
}
