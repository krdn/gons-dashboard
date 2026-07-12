import { describe, it, expect, vi, beforeEach } from "vitest";

const sendPushToUserMock = vi.hoisted(() => vi.fn());
const markRemindedMock = vi.hoisted(() => vi.fn());
vi.mock("@/shared/lib/push", () => ({ sendPushToUser: sendPushToUserMock }));
vi.mock("@/entities/memo/server", () => ({ markActionItemReminded: markRemindedMock }));

import { remindDueActionItem } from "./remindDueActions";

const item = { id: "a1", userId: "u1", title: "LG 위약금 문의", memoTitle: "통신사 정리 메모" };

beforeEach(() => {
  sendPushToUserMock.mockReset().mockResolvedValue({ total: 1, sent: 1, expired: 0, errors: 0 });
  markRemindedMock.mockReset().mockResolvedValue(undefined);
});

describe("remindDueActionItem", () => {
  it("push 발송 후 reminded 마킹 — payload 규약(제목 ⏰, body=메모 제목, 항목별 tag)", async () => {
    const r = await remindDueActionItem(item);
    expect(r).toEqual({ kind: "reminded", push: { total: 1, sent: 1 } });
    expect(sendPushToUserMock).toHaveBeenCalledWith("u1", {
      title: "⏰ LG 위약금 문의",
      body: "통신사 정리 메모",
      url: "/memos",
      tag: "memo-action-a1",
    });
    expect(markRemindedMock).toHaveBeenCalledWith("a1");
  });

  it("구독 없음(total 0)이어도 마킹 — 무한 재시도 방지 (스펙 §5)", async () => {
    sendPushToUserMock.mockResolvedValue({ total: 0, sent: 0, expired: 0, errors: 0 });
    const r = await remindDueActionItem(item);
    expect(r.push).toEqual({ total: 0, sent: 0 });
    expect(markRemindedMock).toHaveBeenCalledWith("a1");
  });

  it("mark 실패는 best-effort — push 성공 결과를 뒤집지 않는다 (PR #157 관례)", async () => {
    markRemindedMock.mockRejectedValue(new Error("db down"));
    const r = await remindDueActionItem(item);
    expect(r).toEqual({ kind: "reminded", push: { total: 1, sent: 1 } });
  });
});
