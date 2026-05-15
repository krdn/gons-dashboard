import { TigerNarrative } from "@/entities/tiger-reading/ui/TigerNarrative";
import type { PlayMCPCompatibilityResult } from "@/entities/tiger-reading";

interface Props {
  payload: PlayMCPCompatibilityResult;
  nickname1: string;
  nickname2: string;
}

export function TigerCompatibilityCard({ payload, nickname1, nickname2 }: Props) {
  return (
    <article className="rounded-xl border bg-white p-6 shadow-sm">
      <header className="mb-4 flex items-center gap-3">
        <span className="text-2xl">🐯</span>
        <div>
          <h2 className="text-lg font-semibold">인연 궁합</h2>
          <p className="text-sm text-gray-600">{nickname1} × {nickname2}</p>
        </div>
      </header>
      <TigerNarrative narrative={payload.result.suggested_narrative_ko} />
    </article>
  );
}
