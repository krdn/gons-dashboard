import Link from "next/link";
import type { HelpFeature } from "../model/types";

interface FeatureDetailCardProps {
  feature: HelpFeature;
  /** 지도에서 선택된 카드 — 하이라이트 링으로 시선 유도. */
  active: boolean;
}

export function FeatureDetailCard({ feature, active }: FeatureDetailCardProps) {
  return (
    <article
      data-active={active || undefined}
      className={
        "rounded-lg border bg-white p-4 transition-shadow " +
        (active
          ? "border-neutral-900 shadow-[0_0_0_2px_rgba(23,23,23,0.15)]"
          : "border-[var(--color-hairline)]")
      }
    >
      <header className="flex items-center gap-2">
        <span aria-hidden className="text-lg">
          {feature.icon}
        </span>
        <h4 className="text-sm font-semibold text-neutral-900">{feature.title}</h4>
        {feature.auto && (
          <span className="rounded bg-neutral-200 px-1.5 py-px text-[10px] font-medium text-neutral-600">
            자동
          </span>
        )}
      </header>
      <p className="mt-1.5 text-sm text-neutral-600">{feature.summary}</p>
      <h5 className="mt-3 text-xs font-semibold text-neutral-500">
        {feature.auto ? "이렇게 동작해요" : "이렇게 사용해요"}
      </h5>
      <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-neutral-700">
        {feature.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {feature.tips && feature.tips.length > 0 && (
        <>
          <h5 className="mt-3 text-xs font-semibold text-neutral-500">알아두면 좋아요</h5>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-neutral-600">
            {feature.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </>
      )}
      {feature.link && (
        <Link
          href={feature.link.href}
          className="mt-3 inline-block text-sm font-medium text-neutral-900 underline underline-offset-2 hover:text-neutral-600"
        >
          {feature.link.label} →
        </Link>
      )}
    </article>
  );
}
