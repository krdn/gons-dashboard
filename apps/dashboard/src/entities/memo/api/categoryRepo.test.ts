import { describe, it, expect, beforeEach } from "vitest";
import { like } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { memoCategories } from "@/shared/lib/db/schema";
import { listCategories } from "./categoryRepo";

// 통합 테스트 — TEST_DATABASE_URL 필요.
// 태그 등록(구 upsertCategory)은 fillMemoCategoryWithTag 트랜잭션으로 흡수됨 —
// 등록·멱등·라벨 불변 정책 검증은 tests/memo-fill-category.test.ts 담당.
const PREFIX = `catrepo${Date.now()}`;

describe("categoryRepo", () => {
  beforeEach(async () => {
    // 병렬 테스트 파일과 격리 — 이 파일의 sentinel 태그만 정리. 광역(비-시드 전체)
    // 삭제는 금지: memos.category FK 가 set null 이라 다른 파일의 진행 중 fixture 를 오염.
    await db.delete(memoCategories).where(like(memoCategories.id, `${PREFIX}%`));
  });

  it("listCategories는 시드를 먼저, 그 뒤 등록 태그를 반환한다", async () => {
    await db.insert(memoCategories).values({ id: `${PREFIX}-tag`, labelKo: "회의록", isSeed: false });
    const rows = await listCategories();
    const seedCount = rows.filter((r) => r.isSeed).length;
    expect(seedCount).toBeGreaterThan(0);
    expect(rows.slice(0, seedCount).every((r) => r.isSeed)).toBe(true);
    expect(rows.find((r) => r.id === `${PREFIX}-tag`)?.labelKo).toBe("회의록");
  });
});
