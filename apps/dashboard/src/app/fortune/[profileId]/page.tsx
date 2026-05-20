import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { getFortuneProfile } from "@/entities/fortune-profile";
import {
  ensureChartAndReadings,
  generateYearlyReading,
} from "@/features/saju-reading";
import { getTodayDailyFortune } from "@/entities/saju-chart";
import {
  SajuDetailHeader,
  SajuPillarsBoard,
  SajuElementsChart,
  SajuTenGodsTable,
  SajuPatternCard,
  SajuMajorFortuneTimeline,
  SajuYearlyReading,
  SajuDailyFortune,
  SajuReadingSections,
} from "@/widgets/saju-detail";
import { SajuTriLifetime } from "@/widgets/saju-tri-lifetime";
import { SajuTriYearly } from "@/widgets/saju-tri-yearly";
import { SajuTriMonthly } from "@/widgets/saju-tri-monthly";
import { parseSajuModelKey } from "@/shared/lib/llm/saju-model-registry-meta";
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
  DailyFortunePayload,
  SajuChart,
} from "@gons/saju";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ profileId: string }>;
  searchParams: Promise<{ model?: string | string[]; tab?: string | string[] }>;
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

function kstTodayDate(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
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

  // 3. 세운 (lazy) + 일진 (cron이 채운 row) 병렬 + 부분 실패 허용
  const [yearlyResult, dailyRow] = await Promise.all([
    generateYearlyReading({
      chart: sajuChart,
      chartId: chart.id,
      year: currentYear,
    }).then(
      (r) => ({ ok: true as const, body: r.body }),
      (e: unknown) => ({
        ok: false as const,
        error: String(e instanceof Error ? e.message : e).slice(0, 200),
      }),
    ),
    getTodayDailyFortune(chart.id, kstTodayDate()).catch(() => null),
  ]);

  return (
    <main className="mx-auto w-full max-w-[900px] px-6 py-12">
      <div className="mb-6 flex items-start justify-between gap-4">
        <SajuDetailHeader profile={profile} />
        <SajuModelPicker selected={modelKey} />
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

          {dailyRow && (
            <section
              aria-labelledby="daily-heading"
              className="mb-8 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
            >
              <h2
                id="daily-heading"
                className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]"
              >
                오늘 일진
              </h2>
              <SajuDailyFortune
                payload={dailyRow.payload as DailyFortunePayload}
                dayPillar={`${dailyRow.dayStem}${dailyRow.dayBranch}`}
              />
            </section>
          )}

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
