import { describe, expect, it } from "vitest";
import { parseSnapshotCount } from "./parseSnapshotCount";

describe("parseSnapshotCount", () => {
  it("skills 스냅샷 stdout 에서 개수를 파싱한다", () => {
    const out = "[snapshot-skills] ✅ 생성 38개 / skip 2개 / 한글 overlay 36개";
    expect(parseSnapshotCount(out)).toBe(38);
  });

  it("plugins 스냅샷 stdout 에서 개수를 파싱한다", () => {
    const out =
      "[snapshot-plugins] ✅ 생성 12개 / 활성 8 / 휴면 4 / 경로없음 0 / 한글 overlay 5";
    expect(parseSnapshotCount(out)).toBe(12);
  });

  it("여러 줄 stdout 에서도 생성 줄만 찾아낸다", () => {
    const out = "warn: something\n[snapshot-agents] ✅ 생성 27개 / skip 0개\ndone";
    expect(parseSnapshotCount(out)).toBe(27);
  });

  it("매칭이 없으면 undefined 를 반환한다", () => {
    expect(parseSnapshotCount("no count here")).toBeUndefined();
  });
});
