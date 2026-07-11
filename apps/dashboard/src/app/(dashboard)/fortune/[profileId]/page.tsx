import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { getFortuneProfile } from "@/entities/fortune-profile/server";
import {
  ensureChartAndReadings,
  generateYearlyReading,
} from "@/features/saju-reading";
import {
  SajuDetailHeader,
  SajuPillarsBoard,
  SajuElementsChart,
  SajuTenGodsTable,
  SajuPatternCard,
  SajuMajorFortuneTimeline,
  SajuYearlyReading,
  SajuReadingSections,
} from "@/widgets/saju-detail";
import { SajuTriLifetime } from "@/widgets/saju-tri-lifetime";
import { SajuTriYearly } from "@/widgets/saju-tri-yearly";
import { SajuTriMonthly } from "@/widgets/saju-tri-monthly";
import { SajuTriDaily } from "@/widgets/saju-tri-daily";
import { parseSajuModelKey } from "@/shared/lib/llm/saju-model-registry-meta";
import { getSajuModelRegistry } from "@/shared/lib/llm/saju-model-registry";
import {
  isLlmModelIdForProvider,
  sanitizeLlmModelId,
} from "@/shared/lib/llm/provider-model-catalog";
import { loadProviderModelCatalog } from "@/shared/lib/llm/provider-model-catalog-server";
import { SajuModelPicker } from "@/features/saju-model-picker";
import { TabsNav, TabPanel, TabSkeleton } from "@/shared/ui/Tabs";
import {
  FORTUNE_TAB_KEYS,
  FORTUNE_TAB_META,
  parseFortuneTabKey,
} from "@/shared/lib/saju/tab-key";
import type {
  Element,
  MajorFortune,
  Strength,
  TenGodAssignment,
  Stem,
  Branch,
  SajuChart,
} from "@krdn/saju";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ profileId: string }>;
  searchParams: Promise<{
    model?: string | string[];
    modelId?: string | string[];
    tab?: string | string[];
  }>;
};

const FORTUNE_TAB_PREFIX = "fortune";
const FORTUNE_TABS = FORTUNE_TAB_KEYS.map((k) => ({
  key: k,
  label: FORTUNE_TAB_META[k].label,
}));

function ageFromBirthDate(birthDate: string): number {
  const [y, m, d] = birthDate.split("-").map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  const hadBirthday =
    now.getMonth() + 1 > m ||
    (now.getMonth() + 1 === m && now.getDate() >= d);
  if (!hadBirthday) age -= 1;
  return age;
}

export default async function SajuDetailPage({ params, searchParams }: Props) {
  const { profileId } = await params;
  const sp = await searchParams;
  const modelKey = parseSajuModelKey(
    Array.isArray(sp.model) ? sp.model[0] : sp.model,
  );
  const activeTab = parseFortuneTabKey(sp.tab);
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  // 상세 모델 ID — 공급사 일치 + 형식 통과 시에만 사용, 아니면 registry 기본값
  // (createNarrativeHandler 의 폴백 규칙과 동일).
  const registry = await getSajuModelRegistry();
  const requestedModelId = sanitizeLlmModelId(
    Array.isArray(sp.modelId) ? sp.modelId[0] : sp.modelId,
  );
  const modelId =
    requestedModelId !== null &&
    isLlmModelIdForProvider(modelKey, requestedModelId)
      ? requestedModelId
      : registry[modelKey].id;
  const modelCatalogSnapshot = await loadProviderModelCatalog({
    defaults: {
      claude: registry.claude.id,
      codex: registry.codex.id,
      gemini: registry.gemini.id,
    },
    defaultMode: "always",
  });

  const profile = await getFortuneProfile(profileId, session.user.id);
  if (!profile) notFound();

  const currentAge = ageFromBirthDate(profile.birthDate);
  const currentYear = new Date().getFullYear();

  // 1. 차트 + 5섹션 해설 (Phase 1)
  const result = await ensureChartAndReadings({
    profileId,
    userId: session.user.id,
    currentAge,
  });
  if (!result) notFound();
  const { chart, readings, errors } = result;

  // 2. jsonb 필드 narrow + SajuChart 형태로 변환 (yearly에 넘기기 위해)
  const tenGods = chart.tenGods as TenGodAssignment;
  const strength = chart.strength as Strength;
  const yongSin = chart.yongSin as Element[];
  const giSin = chart.giSin as Element[];
  const majorFortunes = chart.majorFortunes as MajorFortune[];
  const elements = chart.elements as SajuChart["elements"];

  const sajuChart: SajuChart = {
    pillars: {
      year: { stem: chart.yearStem as Stem, branch: chart.yearBranch as Branch },
      month: { stem: chart.monthStem as Stem, branch: chart.monthBranch as Branch },
      day: { stem: chart.dayStem as Stem, branch: chart.dayBranch as Branch },
      hour:
        chart.hourStem && chart.hourBranch
          ? { stem: chart.hourStem as Stem, branch: chart.hourBranch as Branch }
          : null,
    },
    elements,
    strength,
    tenGods,
    pattern: chart.pattern,
    yongSin,
    giSin,
    majorFortunes,
    inputHash: chart.inputHash,
  };

  // 3. 세운 (lazy) — daily 는 별도 탭으로 분리 (SajuTriDaily widget)
  const yearlyResult = await generateYearlyReading({
    chart: sajuChart,
    chartId: chart.id,
    year: currentYear,
  }).then(
    (r) => ({ ok: true as const, body: r.body }),
    (e: unknown) => ({
      ok: false as const,
      error: String(e instanceof Error ? e.message : e).slice(0, 200),
    }),
  );

  return (
    <main className="mx-auto w-full max-w-[900px] px-6 py-12">
      <div className="mb-6 flex items-start justify-between gap-4">
        <SajuDetailHeader profile={profile} />
        <SajuModelPicker
          selected={modelKey}
          selectedModelId={modelId}
          snapshot={modelCatalogSnapshot}
        />
      </div>

      <TabsNav
        tabs={FORTUNE_TABS}
        activeKey={activeTab}
        ariaLabel="사주 분석 탭"
        idPrefix={FORTUNE_TAB_PREFIX}
      />

      {activeTab === "lifetime" && (
        <TabPanel tabKey="lifetime" idPrefix={FORTUNE_TAB_PREFIX}>
          <Suspense fallback={<TabSkeleton />}>
            <SajuTriLifetime
              profileId={profileId}
              userId={session.user.id}
              modelKey={modelKey}
              modelId={modelId}
            />
          </Suspense>
        </TabPanel>
      )}

      {activeTab === "yearly" && (
        <TabPanel tabKey="yearly" idPrefix={FORTUNE_TAB_PREFIX}>
          <Suspense fallback={<TabSkeleton />}>
            <SajuTriYearly
              profileId={profileId}
              userId={session.user.id}
              modelKey={modelKey}
              modelId={modelId}
            />
          </Suspense>
        </TabPanel>
      )}

      {activeTab === "monthly" && (
        <TabPanel tabKey="monthly" idPrefix={FORTUNE_TAB_PREFIX}>
          <Suspense fallback={<TabSkeleton />}>
            <SajuTriMonthly
              profileId={profileId}
              userId={session.user.id}
              modelKey={modelKey}
              modelId={modelId}
            />
          </Suspense>
        </TabPanel>
      )}

      {activeTab === "daily" && (
        <TabPanel tabKey="daily" idPrefix={FORTUNE_TAB_PREFIX}>
          <Suspense fallback={<TabSkeleton />}>
            <SajuTriDaily
              profileId={profileId}
              userId={session.user.id}
              modelKey={modelKey}
              modelId={modelId}
            />
          </Suspense>
        </TabPanel>
      )}

      {activeTab === "chart" && (
        <TabPanel tabKey="chart" idPrefix={FORTUNE_TAB_PREFIX}>
          <section
            aria-labelledby="pillars-heading"
            className="mb-8 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
          >
            <h2
              id="pillars-heading"
              className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]"
            >
              사주팔자
            </h2>
            <SajuPillarsBoard chart={chart} tenGods={tenGods} />
          </section>

          <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
            <section
              aria-labelledby="elements-heading"
              className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
            >
              <h2
                id="elements-heading"
                className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]"
              >
                오행 분포
              </h2>
              <SajuElementsChart elements={elements} />
            </section>
            <section
              aria-labelledby="pattern-heading"
              className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
            >
              <h2
                id="pattern-heading"
                className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]"
              >
                격국 · 용신
              </h2>
              <SajuPatternCard
                pattern={chart.pattern}
                strength={strength}
                yongSin={yongSin}
                giSin={giSin}
              />
            </section>
          </div>

          <section
            aria-labelledby="ten-gods-heading"
            className="mb-8 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
          >
            <h2
              id="ten-gods-heading"
              className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]"
            >
              십신
            </h2>
            <SajuTenGodsTable tenGods={tenGods} />
          </section>
        </TabPanel>
      )}

      {activeTab === "reading" && (
        <TabPanel tabKey="reading" idPrefix={FORTUNE_TAB_PREFIX}>
          <section
            aria-labelledby="major-fortune-heading"
            className="mb-8 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
          >
            <h2
              id="major-fortune-heading"
              className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]"
            >
              대운 흐름
            </h2>
            <SajuMajorFortuneTimeline
              majorFortunes={majorFortunes}
              currentAge={currentAge}
              dayStem={chart.dayStem as Stem}
              majorFortuneBody={readings.major_fortune}
            />
          </section>

          <section
            aria-labelledby="yearly-heading"
            className="mb-8 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
          >
            <h2
              id="yearly-heading"
              className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]"
            >
              {currentYear}년 세운 · 월운
            </h2>
            <SajuYearlyReading
              body={yearlyResult.ok ? yearlyResult.body : null}
              error={yearlyResult.ok ? null : yearlyResult.error}
              year={currentYear}
            />
          </section>

          <section aria-labelledby="readings-heading" className="mb-8">
            <h2 id="readings-heading" className="mb-4 text-base font-semibold">
              해설
            </h2>
            <SajuReadingSections readings={readings} errors={errors} />
          </section>
        </TabPanel>
      )}
    </main>
  );
}
