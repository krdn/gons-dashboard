import { describe, expect, test } from "vitest";
import { pickResurfaced, RESURFACE_COUNT } from "./resurface";

const NOW = new Date("2026-07-12T10:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

function candidate(id: string, ageDays: number) {
  return { id, createdAt: daysAgo(ageDays) };
}

describe("pickResurfaced", () => {
  test("30일 미만 후보는 제외한다", () => {
    const picked = pickResurfaced(
      [candidate("recent", 5), candidate("old", 60)],
      NOW,
      () => 0,
    );
    expect(picked.map((c) => c.id)).toEqual(["old"]);
  });

  test("후보 없음 → 빈 배열", () => {
    expect(pickResurfaced([candidate("a", 1)], NOW, () => 0)).toEqual([]);
    expect(pickResurfaced([], NOW, () => 0)).toEqual([]);
  });

  test("최대 RESURFACE_COUNT개, 비복원(중복 없음)", () => {
    const pool = [candidate("a", 40), candidate("b", 50), candidate("c", 60), candidate("d", 70)];
    const picked = pickResurfaced(pool, NOW, () => 0);
    expect(picked.length).toBe(RESURFACE_COUNT);
    expect(new Set(picked.map((c) => c.id)).size).toBe(RESURFACE_COUNT);
  });

  test("가중 추출 — rng 값에 따라 나이 비례 구간이 선택된다", () => {
    const pool = [candidate("age100", 100), candidate("age40", 40)]; // total=140
    // r=0.5*140=70 → 첫 구간(100) 안 → age100
    expect(pickResurfaced(pool, NOW, () => 0.5)[0].id).toBe("age100");
    // r=0.9*140=126 → 첫 구간(100) 초과 → age40
    expect(pickResurfaced(pool, NOW, () => 0.9)[0].id).toBe("age40");
  });

  test("부동소수 잔차 방어 — rng()가 1에 근접해도 마지막 후보로 폴백", () => {
    const pool = [candidate("a", 40), candidate("b", 50)];
    const picked = pickResurfaced(pool, NOW, () => 0.999999999);
    expect(picked.length).toBe(2);
  });
});
