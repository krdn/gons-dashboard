import { describe, expect, test } from "vitest";
import {
  ACTION_ITEM_KINDS,
  ACTION_ITEM_KIND_LABELS,
  ACTION_ITEM_STATUSES,
  canTransition,
  isActionItemKind,
  isActionItemStatus,
} from "./actionItem";

describe("actionItem 상수", () => {
  test("kind 라벨이 1:1로 존재한다", () => {
    expect(Object.keys(ACTION_ITEM_KIND_LABELS).sort()).toEqual([...ACTION_ITEM_KINDS].sort());
  });

  test("가드 — 유효/무효 판별", () => {
    for (const k of ACTION_ITEM_KINDS) expect(isActionItemKind(k)).toBe(true);
    for (const s of ACTION_ITEM_STATUSES) expect(isActionItemStatus(s)).toBe(true);
    expect(isActionItemKind("meeting")).toBe(false);
    expect(isActionItemStatus("pending")).toBe(false);
    expect(isActionItemStatus(null)).toBe(false);
  });
});

describe("canTransition — 상태 기계", () => {
  test("허용 전이", () => {
    expect(canTransition("proposed", "accepted")).toBe(true);
    expect(canTransition("proposed", "dismissed")).toBe(true);
    expect(canTransition("accepted", "done")).toBe(true);
    expect(canTransition("accepted", "dismissed")).toBe(true);
  });

  test("불법 전이 — 종단 상태에서 이동 불가, 건너뛰기 불가", () => {
    expect(canTransition("proposed", "done")).toBe(false); // 수락 없이 완료 불가
    expect(canTransition("dismissed", "accepted")).toBe(false);
    expect(canTransition("done", "accepted")).toBe(false);
    expect(canTransition("accepted", "proposed")).toBe(false); // 역행 불가
    expect(canTransition("proposed", "proposed")).toBe(false);
  });
});
