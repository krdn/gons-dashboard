import { TigerNarrative } from "@/entities/tiger-reading/ui/TigerNarrative";
import type { PlayMCPAnalysisResult } from "@/entities/tiger-reading";

interface Props { payload: PlayMCPAnalysisResult; }

export function TigerAnalysisCard({ payload }: Props) {
  const r = payload.result;
  const health = r.life_hints.health_details;
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

      <section className="mb-5">
        <h3 className="mb-2 text-sm font-semibold text-gray-700">유형 요약</h3>
        <p className="text-sm text-gray-800">{r.type_summary_ko}</p>
      </section>

      <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <PersonalityCell label="첫 인상" value={r.personality.first_impression_ko} />
        <PersonalityCell label="핵심 성품" value={r.personality.core_trait_ko} />
        <PersonalityCell label="강점" value={r.personality.strengths_ko} />
      </section>

      <section className="mb-5 rounded-lg border border-amber-100 bg-amber-50 p-4">
        <h3 className="mb-1 text-sm font-semibold text-amber-900">보강 안내</h3>
        <p className="text-sm text-amber-900">{r.supplement_hint_ko}</p>
      </section>

      <section className="mb-5">
        <h3 className="mb-2 text-sm font-semibold text-gray-700">호(虎)의 풀이</h3>
        <TigerNarrative narrative={r.suggested_narrative_ko} emphasizeFirstParagraph />
      </section>

      <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <LifeHintCell label="직업" value={r.life_hints.career_ko} />
        <LifeHintCell label="관계" value={r.life_hints.relationship_ko} />
        <LifeHintCell label="건강" value={r.life_hints.health_summary_ko} />
      </section>

      <section className="rounded border bg-gray-50 p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-700">
          오행 상세 {health.balanced ? "(균형)" : "(불균형)"}
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ElementList label="과한 오행" items={health.excess} tone="excess" />
          <ElementList label="부족한 오행" items={health.lacking} tone="lacking" />
        </div>
      </section>
    </article>
  );
}

function PersonalityCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-sm text-gray-800">{value}</p>
    </div>
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

function ElementList({
  label,
  items,
  tone,
}: {
  label: string;
  items: Array<{ element: string; ko: string }>;
  tone: "excess" | "lacking";
}) {
  const toneClass =
    tone === "excess"
      ? "border-red-200 bg-red-50 text-red-900"
      : "border-blue-200 bg-blue-50 text-blue-900";
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500">—</p>
      ) : (
        <ul className="space-y-1">
          {items.map((it, idx) => (
            <li key={idx} className={`rounded border px-2 py-1 text-xs ${toneClass}`}>
              <span className="font-semibold">{it.element}</span> · {it.ko}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
