import type { HelpChapter, HelpFeature } from "../model/types";

interface LifecycleFlowProps {
  chapters: HelpChapter[];
  features: HelpFeature[];
  activeFeatureId: string | null;
  onSelectFeature: (id: string) => void;
}

// 메모 생애주기 여정 지도 — inFlow 구간을 세로 레인으로, 기능을 클릭 가능한 노드로.
// 실선 노드 = 사용자가 하는 일, 점선 노드 + "자동" 뱃지 = 시스템이 알아서 하는 일.
export function LifecycleFlow({
  chapters,
  features,
  activeFeatureId,
  onSelectFeature,
}: LifecycleFlowProps) {
  const lanes = chapters.filter((c) => c.inFlow);
  return (
    <nav aria-label="메모 생애주기 지도" className="space-y-0">
      <p className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded border border-neutral-400" aria-hidden />
          직접 하는 일
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded border border-dashed border-neutral-400" aria-hidden />
          자동으로 되는 일
        </span>
        <span>노드를 누르면 아래 상세 설명으로 이동합니다.</span>
      </p>
      <ol className="space-y-0">
        {lanes.map((chapter, i) => (
          <li key={chapter.id}>
            {i > 0 && (
              <div aria-hidden className="my-1 ml-4 h-4 w-px bg-[var(--color-hairline)]" />
            )}
            <section
              aria-label={chapter.title}
              className="rounded-lg border border-[var(--color-hairline)] bg-white p-3"
            >
              <header className="mb-2 flex items-baseline gap-2">
                <span
                  aria-hidden
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-semibold text-white"
                >
                  {i + 1}
                </span>
                <h3 className="text-sm font-semibold text-neutral-900">{chapter.title}</h3>
                <p className="text-xs text-neutral-500">{chapter.tagline}</p>
              </header>
              <div className="flex flex-wrap gap-2">
                {features
                  .filter((f) => f.chapterId === chapter.id)
                  .map((f) => (
                    <FlowNode
                      key={f.id}
                      feature={f}
                      active={f.id === activeFeatureId}
                      onSelect={() => onSelectFeature(f.id)}
                    />
                  ))}
              </div>
            </section>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function FlowNode({
  feature,
  active,
  onSelect,
}: {
  feature: HelpFeature;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={feature.summary}
      aria-current={active ? "true" : undefined}
      className={
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors " +
        (feature.auto ? "border border-dashed " : "border ") +
        (active
          ? "border-neutral-900 bg-neutral-900 text-white"
          : "border-neutral-300 bg-neutral-50 text-neutral-800 hover:border-neutral-500 hover:bg-white")
      }
    >
      <span aria-hidden>{feature.icon}</span>
      {feature.title}
      {feature.auto && (
        <span
          className={
            "rounded px-1 py-px text-[10px] font-medium " +
            (active ? "bg-white/20 text-white" : "bg-neutral-200 text-neutral-600")
          }
        >
          자동
        </span>
      )}
    </button>
  );
}
