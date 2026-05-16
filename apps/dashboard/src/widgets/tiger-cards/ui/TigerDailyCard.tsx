import { TigerNarrative } from "@/entities/tiger-reading/ui/TigerNarrative";
import type { PlayMCPDailyResult } from "@/entities/tiger-reading";

interface Props { payload: PlayMCPDailyResult; forDateKst: string; }

export function TigerDailyCard({ payload, forDateKst }: Props) {
  const r = payload.result;
  return (
    <article className="rounded-xl border bg-white p-6 shadow-sm">
      <header className="mb-4 flex items-center gap-3">
        <span className="text-2xl">🐯</span>
        <div>
          <h2 className="text-lg font-semibold">오늘의 기운</h2>
          {/* locale-free 포맷 — Gotcha #3 회피 */}
          <p className="text-sm text-gray-600">
            {r.profile.nickname_short} · {forDateKst} (KST)
          </p>
        </div>
      </header>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">호(虎)의 오늘 풀이</h3>
        <TigerNarrative narrative={r.suggested_narrative_ko} emphasizeFirstParagraph />
      </section>
    </article>
  );
}
