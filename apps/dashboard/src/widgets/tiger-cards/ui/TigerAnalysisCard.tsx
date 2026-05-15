import { TigerNarrative } from "@/entities/tiger-reading/ui/TigerNarrative";
import type { PlayMCPAnalysisResult } from "@/entities/tiger-reading";

interface Props { payload: PlayMCPAnalysisResult; }

export function TigerAnalysisCard({ payload }: Props) {
  const r = payload.result;
  return (
    <article className="rounded-xl border bg-white p-6 shadow-sm">
      <header className="mb-4 flex items-center gap-3">
        <span className="text-2xl">🐯</span>
        <div>
          <h2 className="text-lg font-semibold">사주 분석</h2>
          <p className="text-sm text-gray-600">{r.profile.nickname_short}</p>
        </div>
      </header>
      <section className="mb-4 flex flex-wrap gap-2">
        <span className="rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-900">
          {r.type_summary_ko.split(" - ")[0]}
        </span>
        <span className="rounded-full bg-amber-50 px-3 py-1 text-sm text-amber-900">
          {r.element_tendency_ko}
        </span>
      </section>
      <TigerNarrative narrative={r.suggested_narrative_ko} emphasizeFirstParagraph />
      <section className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <LifeHintCell label="직업" value={r.life_hints.career_ko} />
        <LifeHintCell label="관계" value={r.life_hints.relationship_ko} />
        <LifeHintCell label="건강" value={r.life_hints.health_summary_ko} />
      </section>
    </article>
  );
}

function LifeHintCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-gray-50 p-3">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-sm text-gray-800">{value}</p>
    </div>
  );
}
