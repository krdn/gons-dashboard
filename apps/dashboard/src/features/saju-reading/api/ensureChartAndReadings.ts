import "server-only";
import { generateChart } from "./generateChart";
import { generateReading } from "./generateReading";
import { getFortuneProfile } from "@/entities/fortune-profile";
import { READING_SECTIONS, type ReadingSection } from "@/entities/saju-chart";
import type { SajuChartRow } from "@/entities/saju-chart";

export interface EnsureChartAndReadingsResult {
  chart: SajuChartRow;
  readings: Record<ReadingSection, string | null>;
  errors: Array<{ section: ReadingSection; message: string }>;
}

export async function ensureChartAndReadings(input: {
  profileId: string;
  userId: string;
  currentAge?: number;
}): Promise<EnsureChartAndReadingsResult | null> {
  // ownership 가드 — 다른 유저 프로필이면 null (호출자가 notFound() 처리)
  const profile = await getFortuneProfile(input.profileId, input.userId);
  if (!profile) return null;

  // 차트 생성/재사용
  const { chart, computed } = await generateChart({
    profileId: profile.id,
    birthDate: profile.birthDate,
    birthTime: profile.birthTime,
    calendar: profile.calendar,
    gender: profile.gender,
    birthCity: profile.birthCity,
  });

  // 5섹션 병렬 생성 — allSettled로 부분 실패 허용
  const results = await Promise.allSettled(
    READING_SECTIONS.map(
      async (section): Promise<{ section: ReadingSection; body: string }> => {
        try {
          const r = await generateReading({
            chartId: chart.id,
            chart: computed,
            section,
            currentAge: input.currentAge,
          });
          return { section, body: r.body };
        } catch (e) {
          // section 정보를 message 에 prefix 로 박아 호출자가 매칭
          throw new Error(
            `[${section}] ${(e as Error).message}`,
          );
        }
      },
    ),
  );

  const readings = Object.fromEntries(
    READING_SECTIONS.map((s) => [s, null as string | null]),
  ) as Record<ReadingSection, string | null>;
  const errors: Array<{ section: ReadingSection; message: string }> = [];

  for (const r of results) {
    if (r.status === "fulfilled") {
      readings[r.value.section] = r.value.body;
    } else {
      const msg = (r.reason as Error).message ?? String(r.reason);
      const match = /^\[(\w+)\]\s*(.+)$/.exec(msg);
      if (match) {
        errors.push({
          section: match[1] as ReadingSection,
          message: match[2],
        });
      } else {
        errors.push({
          section: "overview",
          message: msg,
        });
      }
    }
  }

  return { chart, readings, errors };
}
