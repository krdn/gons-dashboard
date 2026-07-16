"use client";
import { useRef, useState } from "react";
import type { MemoHelpGuide } from "../model/types";
import { LifecycleFlow } from "./LifecycleFlow";
import { FeatureDetailCard } from "./FeatureDetailCard";

// 도움말 조합 뷰 — 위: 30초 시작 + 생애주기 지도, 아래: 구간별 기능 상세 전체 펼침.
// 지도 노드 클릭은 "목차에서 점프" 역할: 해당 상세 카드로 스크롤 + 하이라이트.
export function MemoHelpView({ guide }: { guide: MemoHelpGuide }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  function jumpTo(featureId: string) {
    setActiveId(featureId);
    // jsdom 등 scrollIntoView 미구현 환경 방어 — 하이라이트만으로도 동작 성립.
    cardRefs.current[featureId]?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="memo-help-quickstart">
        <h2 id="memo-help-quickstart" className="text-sm font-semibold text-neutral-900">
          ⏱ 30초 시작하기
        </h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-neutral-700">
          {guide.quickStart.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="memo-help-map">
        <h2 id="memo-help-map" className="mb-2 text-sm font-semibold text-neutral-900">
          🗺 메모 하나의 여정
        </h2>
        <LifecycleFlow
          chapters={guide.chapters}
          features={guide.features}
          activeFeatureId={activeId}
          onSelectFeature={jumpTo}
        />
      </section>

      <section aria-labelledby="memo-help-details" className="space-y-6">
        <h2 id="memo-help-details" className="text-sm font-semibold text-neutral-900">
          📖 기능별 자세히 보기
        </h2>
        {guide.chapters.map((chapter) => {
          const chapterFeatures = guide.features.filter((f) => f.chapterId === chapter.id);
          if (chapterFeatures.length === 0) return null;
          return (
            <section key={chapter.id} aria-label={chapter.title}>
              <header className="mb-2 flex items-baseline gap-2">
                <h3 className="text-sm font-semibold text-neutral-800">{chapter.title}</h3>
                <p className="text-xs text-neutral-500">{chapter.tagline}</p>
              </header>
              <div className="space-y-3">
                {chapterFeatures.map((feature) => (
                  <div
                    key={feature.id}
                    ref={(el) => {
                      cardRefs.current[feature.id] = el;
                    }}
                  >
                    <FeatureDetailCard feature={feature} active={feature.id === activeId} />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </section>
    </div>
  );
}
