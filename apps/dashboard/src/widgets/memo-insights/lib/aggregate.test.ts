import { describe, it, expect } from "vitest";
import type { MemoFact, MemoDigest, MemoActionItem, MemoTransformation } from "@/entities/memo/server";
import type { MemoCategoryRow } from "@/entities/memo/server";
import {
  buildActivityHeatmap,
  buildDailyTrend,
  buildCategoryDistribution,
  buildActionConversion,
  buildDigestTimeline,
} from "./aggregate";

// KST 자정 = UTC 15:00 전날. 2026-07-14 12:00 KST == 2026-07-14T03:00:00Z.
const NOW = new Date("2026-07-14T03:00:00Z");

let idSeq = 0;
const nextId = () => `id-${idSeq++}`; // 결정적 고유 id (crypto 선례 없음)

function fact(overrides: Partial<MemoFact> = {}): MemoFact {
  return {
    id: nextId(),
    source: "text",
    category: null,
    createdAt: NOW,
    actionsExtractedAt: null,
    ...overrides,
  };
}
// KST 자정 기준 날짜의 정오 UTC Date 생성 (버킷 경계 안전).
function kstNoon(dateStr: string): Date {
  return new Date(`${dateStr}T03:00:00Z`); // 정오 KST
}
// 'YYYY-MM-DD'(KST 자정 기준)에 offsetDays를 더한 날짜 키. aggregate.ts의 내부 addDaysKey와 동일 로직(테스트 fixture 전용, export 없어 로컬 재구현).
function addDaysKeyForTest(dateStr: string, offsetDays: number): string {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const utcMidnightKst = new Date(`${dateStr}T00:00:00Z`).getTime() - KST_OFFSET_MS;
  const shifted = new Date(utcMidnightKst + offsetDays * DAY_MS + KST_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

describe("buildActivityHeatmap", () => {
  it("빈 입력 — 26주 고정 그리드, 모든 카운트 0", () => {
    const h = buildActivityHeatmap([], NOW);
    expect(h.weeks.length).toBe(26);
    expect(h.weeks.every((w) => w.length === 7)).toBe(true);
    expect(h.windowCount).toBe(0);
    expect(h.totalCount).toBe(0);
    expect(h.currentStreak).toBe(0);
    expect(h.longestStreak).toBe(0);
    expect(h.dailyAvg).toBe(0);
  });

  it("오늘 미기록이면 streak을 0으로 만들지 않고 어제부터 센다", () => {
    // 어제·그저께 기록, 오늘 없음
    const facts = [
      fact({ createdAt: kstNoon("2026-07-13") }),
      fact({ createdAt: kstNoon("2026-07-12") }),
    ];
    const h = buildActivityHeatmap(facts, NOW);
    expect(h.currentStreak).toBe(2);
  });

  it("windowCount는 182일 창 내부만, totalCount는 전체", () => {
    const facts = [
      fact({ createdAt: kstNoon("2026-07-13") }), // 창 내
      fact({ createdAt: new Date("2020-01-01T03:00:00Z") }), // 창 밖(과거)
    ];
    const h = buildActivityHeatmap(facts, NOW);
    expect(h.totalCount).toBe(2);
    expect(h.windowCount).toBe(1);
    expect(h.dailyAvg).toBeCloseTo(1 / 182, 6);
  });

  it("183일 초과 연속 기록이어도 currentStreak이 longestStreak을 넘지 않는다 (26주=182일 창 상한 클램프)", () => {
    // 오늘 포함 200일 연속(창 182일보다 긺) 매일 기록.
    const facts: MemoFact[] = [];
    for (let i = 0; i < 200; i++) {
      facts.push(fact({ createdAt: kstNoon(addDaysKeyForTest("2026-07-14", -i)) }));
    }
    const h = buildActivityHeatmap(facts, NOW);
    expect(h.currentStreak).toBeLessThanOrEqual(h.longestStreak);
    expect(h.currentStreak).toBe(182); // HEATMAP_DAYS(26주) 상한
    expect(h.longestStreak).toBe(182);
  });
});

describe("buildDailyTrend", () => {
  it("빈 입력 — days개 연속 날짜 모두 count:0", () => {
    const t = buildDailyTrend([], NOW, 30);
    expect(t.length).toBe(30);
    expect(t.every((p) => p.count === 0)).toBe(true);
    expect(t[t.length - 1].date).toBe("2026-07-14"); // 마지막=오늘 KST
  });

  it("특정 날짜 카운트 집계", () => {
    const facts = [
      fact({ createdAt: kstNoon("2026-07-14") }),
      fact({ createdAt: kstNoon("2026-07-14") }),
      fact({ createdAt: kstNoon("2026-07-13") }),
    ];
    const t = buildDailyTrend(facts, NOW, 30);
    expect(t.find((p) => p.date === "2026-07-14")?.count).toBe(2);
    expect(t.find((p) => p.date === "2026-07-13")?.count).toBe(1);
  });
});

describe("buildCategoryDistribution", () => {
  const cats: MemoCategoryRow[] = [
    { id: "idea", labelKo: "아이디어", isSeed: true, createdAt: NOW },
    { id: "todo", labelKo: "할 일", isSeed: true, createdAt: NOW },
  ];
  it("빈 입력 — 전부 0", () => {
    const d = buildCategoryDistribution([], cats);
    expect(d.byCategory).toEqual([]);
    expect(d.voiceCount).toBe(0);
    expect(d.textCount).toBe(0);
    expect(d.unclassifiedCount).toBe(0);
  });
  it("카테고리·소스·미분류 집계 + labelKo 매핑", () => {
    const facts = [
      fact({ category: "idea", source: "voice" }),
      fact({ category: "idea", source: "text" }),
      fact({ category: null, source: "text" }),
    ];
    const d = buildCategoryDistribution(facts, cats);
    expect(d.byCategory).toContainEqual({ slug: "idea", labelKo: "아이디어", count: 2 });
    expect(d.voiceCount).toBe(1);
    expect(d.textCount).toBe(2);
    expect(d.unclassifiedCount).toBe(1);
  });
});

describe("buildActionConversion", () => {
  function ai(overrides: Partial<MemoActionItem>): MemoActionItem {
    return {
      id: nextId(),
      memoId: "m1",
      userId: "u1",
      kind: "todo",
      title: "t",
      dueAt: null,
      allDay: false,
      status: "proposed",
      remindedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    } as MemoActionItem;
  }
  it("빈 입력 — 퍼널 0, 상태 카운트 4키 모두 0", () => {
    const c = buildActionConversion([], [], []);
    expect(c.totalMemos).toBe(0);
    expect(c.processedMemos).toBe(0);
    expect(c.memosWithActions).toBe(0);
    expect(c.currentStatusCounts).toEqual({ proposed: 0, accepted: 0, dismissed: 0, done: 0 });
    expect(c.transformCount).toBe(0);
    expect(c.transformByPreset).toEqual([]);
  });
  it("퍼널 불변식 totalMemos >= processedMemos >= memosWithActions", () => {
    const facts = [
      fact({ id: "m1", actionsExtractedAt: NOW }), // processed + 액션 있음
      fact({ id: "m2", actionsExtractedAt: NOW }), // processed, 액션 없음
      fact({ id: "m3", actionsExtractedAt: null }), // 미처리
    ];
    const items = [ai({ memoId: "m1", status: "accepted" }), ai({ memoId: "m1", status: "accepted" })];
    const c = buildActionConversion(facts, items, []);
    expect(c.totalMemos).toBe(3);
    expect(c.processedMemos).toBe(2);
    expect(c.memosWithActions).toBe(1);
    expect(c.totalMemos).toBeGreaterThanOrEqual(c.processedMemos);
    expect(c.processedMemos).toBeGreaterThanOrEqual(c.memosWithActions);
  });
  it("액션-행 수는 메모 수를 초과할 수 있다 (accepted 2개)", () => {
    const facts = [fact({ id: "m1", actionsExtractedAt: NOW })];
    const items = [ai({ memoId: "m1", status: "accepted" }), ai({ memoId: "m1", status: "accepted" })];
    const c = buildActionConversion(facts, items, []);
    expect(c.currentStatusCounts.accepted).toBe(2); // 메모는 1개인데 accepted 2
    expect(c.memosWithActions).toBe(1);
  });
  it("변환본 slug 그룹화 — 최근 non-null presetLabel 대표, 빌트인 라벨 폴백", () => {
    function tr(overrides: Partial<MemoTransformation>): MemoTransformation {
      return {
        id: nextId(),
        memoId: "m1",
        preset: "tidy",
        model: "claude",
        content: "x",
        presetLabel: null,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
      } as MemoTransformation;
    }
    const trs = [
      tr({ preset: "tidy", presetLabel: null, createdAt: kstNoon("2026-07-10") }),
      tr({ preset: "tidy", presetLabel: "정돈v2", createdAt: kstNoon("2026-07-12") }), // 최근
      tr({ preset: "c-custom", presetLabel: "내 프리셋", createdAt: kstNoon("2026-07-11") }),
    ];
    const c = buildActionConversion([], [], trs);
    expect(c.transformCount).toBe(3);
    const tidy = c.transformByPreset.find((p) => p.slug === "tidy");
    expect(tidy).toEqual({ slug: "tidy", label: "정돈v2", count: 2 }); // 최근 non-null 라벨
    const custom = c.transformByPreset.find((p) => p.slug === "c-custom");
    expect(custom).toEqual({ slug: "c-custom", label: "내 프리셋", count: 1 });
  });
});

describe("buildDigestTimeline", () => {
  function dg(overrides: Partial<MemoDigest>): MemoDigest {
    return {
      id: nextId(),
      userId: "u1",
      weekEnd: "2026-07-05",
      summary: "s",
      memoCount: 3,
      resurfacedMemoIds: [],
      createdAt: NOW,
      ...overrides,
    } as MemoDigest;
  }
  it("빈 입력 — 빈 배열", () => {
    expect(buildDigestTimeline([])).toEqual([]);
  });
  it("weekEnd·memoCount·재부상 수 매핑", () => {
    const digests = [
      dg({ weekEnd: "2026-06-28", memoCount: 2, resurfacedMemoIds: ["a"] }),
      dg({ weekEnd: "2026-07-05", memoCount: 5, resurfacedMemoIds: ["a", "b"] }),
    ];
    const t = buildDigestTimeline(digests);
    expect(t).toEqual([
      { weekEnd: "2026-06-28", memoCount: 2, resurfacedCount: 1 },
      { weekEnd: "2026-07-05", memoCount: 5, resurfacedCount: 2 },
    ]);
  });
});
