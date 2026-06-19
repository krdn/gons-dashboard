import { TigerNarrative } from "@/entities/tiger-reading";
import type {
  PlayMCPCompatibilityResult,
  PlayMCPCompatibilityPerson,
  PlayMCPCompatTrigram,
} from "@/entities/tiger-reading";

interface Props {
  payload: PlayMCPCompatibilityResult;
  nickname1: string;
  nickname2: string;
}

export function TigerCompatibilityCard({ payload, nickname1, nickname2 }: Props) {
  const r = payload.result;
  const tone = compatGradeTone(r.grade);
  return (
    <article className="rounded-xl border bg-white p-6 shadow-sm">
      <header className="mb-4 flex items-center gap-3">
        <span className="text-2xl">🐯</span>
        <div>
          <h2 className="text-lg font-semibold">인연 궁합</h2>
          <p className="text-sm text-gray-600">{nickname1} × {nickname2}</p>
        </div>
      </header>

      <section className={`mb-5 rounded-lg border p-4 ${tone.surface}`}>
        <div className="mb-2 flex items-baseline gap-3">
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${tone.badge}`}>
            {r.grade}등급 · {r.grade_label_ko}
          </span>
          <span className={`text-sm font-medium ${tone.text}`}>{r.relation_type_ko}</span>
        </div>
        <p className={`text-sm ${tone.text}`}>{r.relation_desc_ko}</p>
      </section>

      <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PersonPanel label="사람 1" person={r.person1} />
        <PersonPanel label="사람 2" person={r.person2} />
      </section>

      <section className="mb-5 rounded-lg border border-purple-100 bg-purple-50 p-4">
        <h3 className="mb-1 text-sm font-semibold text-purple-900">두 분의 케미</h3>
        <p className="text-sm text-purple-900">{r.chemistry_ko}</p>
      </section>

      <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TrigramList
          label="강점"
          items={r.strengths}
          itemClass="border-green-200 bg-green-50 text-green-900"
        />
        <TrigramList
          label="주의점"
          items={r.cautions}
          itemClass="border-amber-200 bg-amber-50 text-amber-900"
        />
      </section>

      <section className="mb-5 rounded border bg-indigo-50 p-4">
        <h3 className="mb-1 text-sm font-semibold text-indigo-900">호(虎)의 조언</h3>
        <p className="text-sm text-indigo-900">{r.advice_ko}</p>
      </section>

      <section className="mb-5">
        <h3 className="mb-2 text-sm font-semibold text-gray-700">요약</h3>
        <p className="text-sm text-gray-800">{r.summary_ko}</p>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">호(虎)의 풀이</h3>
        <TigerNarrative narrative={r.suggested_narrative_ko} />
      </section>
    </article>
  );
}

function PersonPanel({ label, person }: { label: string; person: PlayMCPCompatibilityPerson }) {
  return (
    <div className="rounded border bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-gray-900">{person.nickname_short}</p>
      <p className="mt-0.5 text-xs text-gray-500">
        일주 {person.ilju} · {person.element_ko}
      </p>
      <p className="mt-2 text-sm text-gray-700">
        <span className="font-semibold">첫인상:</span> {person.impression_ko}
      </p>
      <p className="mt-1 text-sm text-gray-700">
        <span className="font-semibold">성품:</span> {person.trait_ko}
      </p>
    </div>
  );
}

function TrigramList({
  label,
  items,
  itemClass,
}: {
  label: string;
  items: PlayMCPCompatTrigram[];
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
              {it.ko}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function compatGradeTone(grade: string): { surface: string; badge: string; text: string } {
  if (grade === "S" || grade === "A") {
    return {
      surface: "border-green-200 bg-green-50",
      badge: "bg-green-100 text-green-900",
      text: "text-green-900",
    };
  }
  if (grade === "B") {
    return {
      surface: "border-amber-200 bg-amber-50",
      badge: "bg-amber-100 text-amber-900",
      text: "text-amber-900",
    };
  }
  return {
    surface: "border-gray-200 bg-gray-50",
    badge: "bg-gray-100 text-gray-900",
    text: "text-gray-900",
  };
}
