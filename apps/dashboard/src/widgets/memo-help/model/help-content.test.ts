import { describe, it, expect } from "vitest";
import { MEMO_HELP_GUIDE } from "./help-content";

// 콘텐츠 무결성 가드 — 오탈자성 참조 깨짐(존재하지 않는 챕터, 빈 단계, 외부 링크)을
// 컴파일 타임에 못 잡는 부분만 검증한다. 문구 자체는 검증 대상이 아니다.
describe("MEMO_HELP_GUIDE 무결성", () => {
  const chapterIds = new Set(MEMO_HELP_GUIDE.chapters.map((c) => c.id));

  it("모든 기능이 존재하는 챕터를 참조한다", () => {
    for (const f of MEMO_HELP_GUIDE.features) {
      expect(chapterIds.has(f.chapterId), `${f.id} → ${f.chapterId}`).toBe(true);
    }
  });

  it("기능 id는 유일하다", () => {
    const ids = MEMO_HELP_GUIDE.features.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("지도(inFlow) 챕터마다 기능이 최소 1개 있다", () => {
    for (const c of MEMO_HELP_GUIDE.chapters.filter((c) => c.inFlow)) {
      const count = MEMO_HELP_GUIDE.features.filter((f) => f.chapterId === c.id).length;
      expect(count, `${c.id} 챕터 기능 수`).toBeGreaterThan(0);
    }
  });

  it("모든 기능에 요약과 단계가 채워져 있다", () => {
    for (const f of MEMO_HELP_GUIDE.features) {
      expect(f.summary.length, `${f.id} summary`).toBeGreaterThan(0);
      expect(f.steps.length, `${f.id} steps`).toBeGreaterThan(0);
      expect(f.steps.every((s) => s.length > 0), `${f.id} 빈 step`).toBe(true);
    }
  });

  it("바로가기 링크는 앱 내부 경로만 가리킨다", () => {
    for (const f of MEMO_HELP_GUIDE.features) {
      if (f.link) expect(f.link.href, `${f.id} link`).toMatch(/^\/memos/);
    }
  });

  it("빠른 시작은 비어 있지 않다", () => {
    expect(MEMO_HELP_GUIDE.quickStart.length).toBeGreaterThan(0);
  });
});
