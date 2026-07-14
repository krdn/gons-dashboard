// 인사이트 순수 집계 함수 — DOM/DB 의존 없음. 시간 의존 함수는 now를 주입받는다(순수성).
// 모든 일자 버킷은 KST(Asia/Seoul) 자정 경계. 각 함수는 빈 입력에서 안전한 기본값을 반환.
import type {
  MemoFact,
  MemoDigest,
  MemoActionItem,
  MemoTransformation,
  MemoCategoryRow,
  ActionItemStatus,
} from "@/entities/memo/server";
import { TRANSFORM_PRESET_LABELS } from "@/entities/memo/server";
import type { TransformPresetId } from "@/entities/memo/server";
import type {
  ActivityHeatmap,
  DailyTrendPoint,
  CategoryDistribution,
  ActionConversion,
  DigestTimelinePoint,
  DayCell,
} from "../model/types";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HEATMAP_WEEKS = 26;
const HEATMAP_DAYS = HEATMAP_WEEKS * 7; // 182

/** Date → KST 자정 기준 'YYYY-MM-DD'. UTC로 9h 밀어 날짜 부품을 뽑는다(locale-free). */
function kstDateKey(d: Date): string {
  const shifted = new Date(d.getTime() + KST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 'YYYY-MM-DD'(KST 자정)에 offsetDays를 더한 날짜 키. */
function addDaysKey(key: string, offsetDays: number): string {
  // KST 자정을 UTC 시각으로 복원해 산술 후 다시 키 추출.
  const utcMidnightKst = new Date(`${key}T00:00:00Z`).getTime() - KST_OFFSET_MS;
  return kstDateKey(new Date(utcMidnightKst + offsetDays * DAY_MS + KST_OFFSET_MS));
}

/** facts를 KST 날짜 키별 카운트 맵으로. */
function countByDate(facts: MemoFact[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of facts) {
    const k = kstDateKey(f.createdAt);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

export function buildActivityHeatmap(facts: MemoFact[], now: Date): ActivityHeatmap {
  const todayKey = kstDateKey(now);
  const counts = countByDate(facts);

  // 182일 연속 날짜 키 (과거 → 오늘). 첫 열이 가장 오래된 주.
  const startKey = addDaysKey(todayKey, -(HEATMAP_DAYS - 1));
  const days: DayCell[] = [];
  for (let i = 0; i < HEATMAP_DAYS; i++) {
    const date = addDaysKey(startKey, i);
    days.push({ date, count: counts.get(date) ?? 0 });
  }

  // 7일 단위로 주 그리드 구성 (26주 × 7일).
  const weeks: DayCell[][] = [];
  for (let w = 0; w < HEATMAP_WEEKS; w++) {
    weeks.push(days.slice(w * 7, w * 7 + 7));
  }

  const windowCount = days.reduce((s, c) => s + c.count, 0);
  const totalCount = facts.length;

  // currentStreak: 오늘부터 역방향 연속 기록일. 오늘 미기록이면 어제부터.
  // longestStreak과 동일한 days 창 배열을 역방향 스캔한다 — 같은 데이터 소스라
  // currentStreak <= longestStreak 불변식이 구조적으로 보장된다. (counts 전체 이력을
  // walk하면 창 경계를 넘어 longestStreak을 초과할 수 있어 UI 모순이 난다.)
  let currentStreak = 0;
  let idx = days.length - 1;
  if (days[idx].count === 0) idx--; // 오늘 미기록이면 어제부터 카운트 시작
  while (idx >= 0 && days[idx].count > 0) {
    currentStreak++;
    idx--;
  }

  // longestStreak: 26주 창 내 최장 연속(days 배열 스캔).
  let longestStreak = 0;
  let run = 0;
  for (const cell of days) {
    if (cell.count > 0) {
      run++;
      if (run > longestStreak) longestStreak = run;
    } else {
      run = 0;
    }
  }

  return {
    weeks,
    windowCount,
    totalCount,
    currentStreak,
    longestStreak,
    dailyAvg: windowCount / HEATMAP_DAYS,
  };
}

export function buildDailyTrend(facts: MemoFact[], now: Date, days = 30): DailyTrendPoint[] {
  const todayKey = kstDateKey(now);
  const counts = countByDate(facts);
  const startKey = addDaysKey(todayKey, -(days - 1));
  const out: DailyTrendPoint[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDaysKey(startKey, i);
    out.push({ date, count: counts.get(date) ?? 0 });
  }
  return out;
}

export function buildCategoryDistribution(
  facts: MemoFact[],
  categories: MemoCategoryRow[],
): CategoryDistribution {
  const labelBySlug = new Map(categories.map((c) => [c.id, c.labelKo]));
  const bySlug = new Map<string, number>();
  let voiceCount = 0;
  let textCount = 0;
  let unclassifiedCount = 0;

  for (const f of facts) {
    if (f.source === "voice") voiceCount++;
    else textCount++;
    if (f.category === null) unclassifiedCount++;
    else bySlug.set(f.category, (bySlug.get(f.category) ?? 0) + 1);
  }

  const byCategory = [...bySlug.entries()]
    .map(([slug, count]) => ({ slug, labelKo: labelBySlug.get(slug) ?? slug, count }))
    .sort((a, b) => b.count - a.count);

  return { byCategory, voiceCount, textCount, unclassifiedCount };
}

export function buildActionConversion(
  facts: MemoFact[],
  actionItems: MemoActionItem[],
  transformations: MemoTransformation[],
): ActionConversion {
  const totalMemos = facts.length;
  const processedMemos = facts.filter((f) => f.actionsExtractedAt !== null).length;

  const memoIdsWithActions = new Set<string>();
  const currentStatusCounts: Record<ActionItemStatus, number> = {
    proposed: 0,
    accepted: 0,
    dismissed: 0,
    done: 0,
  };
  for (const item of actionItems) {
    memoIdsWithActions.add(item.memoId);
    // status는 bare text()라 string — DB CHECK 보장 값이므로 ActionItemStatus로 좁힌다.
    const s = item.status as ActionItemStatus;
    if (s in currentStatusCounts) currentStatusCounts[s]++;
  }

  // 변환본 slug 그룹화 + 결정적 대표 라벨(가장 최근 non-null presetLabel).
  interface Group {
    count: number;
    labelAt: number | null; // 대표 라벨의 createdAt(ms), null=미정
    label: string | null;
  }
  const groups = new Map<string, Group>();
  for (const t of transformations) {
    const g = groups.get(t.preset) ?? { count: 0, labelAt: null, label: null };
    g.count++;
    if (t.presetLabel !== null) {
      const at = t.createdAt.getTime();
      if (g.labelAt === null || at > g.labelAt) {
        g.labelAt = at;
        g.label = t.presetLabel;
      }
    }
    groups.set(t.preset, g);
  }
  const transformByPreset = [...groups.entries()]
    .map(([slug, g]) => ({
      slug,
      label: g.label ?? TRANSFORM_PRESET_LABELS[slug as TransformPresetId] ?? slug,
      count: g.count,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    totalMemos,
    processedMemos,
    memosWithActions: memoIdsWithActions.size,
    currentStatusCounts,
    transformCount: transformations.length,
    transformByPreset,
  };
}

export function buildDigestTimeline(digests: MemoDigest[]): DigestTimelinePoint[] {
  return digests.map((d) => ({
    weekEnd: d.weekEnd,
    memoCount: d.memoCount,
    resurfacedCount: d.resurfacedMemoIds.length,
  }));
}
