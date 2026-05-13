import { notFound, redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { getFortuneProfile } from "@/entities/fortune-profile";
import { ensureChartAndReadings } from "@/features/saju-reading";
import {
  SajuDetailHeader,
  SajuPillarsBoard,
  SajuElementsChart,
  SajuTenGodsTable,
  SajuPatternCard,
  SajuMajorFortuneTimeline,
  SajuReadingSections,
} from "@/widgets/saju-detail";
import type {
  Element,
  MajorFortune,
  Stem,
  Strength,
  TenGodAssignment,
} from "@gons/saju";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ profileId: string }> };

function ageFromBirthDate(birthDate: string): number {
  const [y, m, d] = birthDate.split("-").map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  const hasHadBirthday =
    now.getMonth() + 1 > m ||
    (now.getMonth() + 1 === m && now.getDate() >= d);
  if (!hasHadBirthday) age -= 1;
  return age;
}

export default async function SajuDetailPage({ params }: Props) {
  const { profileId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const profile = await getFortuneProfile(profileId, session.user.id);
  if (!profile) notFound();

  const currentAge = ageFromBirthDate(profile.birthDate);

  const result = await ensureChartAndReadings({
    profileId,
    userId: session.user.id,
    currentAge,
  });
  if (!result) notFound();

  const { chart, readings, errors } = result;

  // jsonb 필드를 위젯 props 타입으로 narrow
  const tenGods = chart.tenGods as TenGodAssignment;
  const strength = chart.strength as Strength;
  const yongSin = chart.yongSin as Element[];
  const giSin = chart.giSin as Element[];
  const majorFortunes = chart.majorFortunes as MajorFortune[];

  return (
    <main className="mx-auto w-full max-w-[900px] px-6 py-12">
      <SajuDetailHeader profile={profile} />

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
          <SajuElementsChart elements={chart.elements} />
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

      <section aria-labelledby="readings-heading" className="mb-8">
        <h2 id="readings-heading" className="mb-4 text-base font-semibold">
          해설
        </h2>
        <SajuReadingSections readings={readings} errors={errors} />
      </section>
    </main>
  );
}
