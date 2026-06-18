import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));

// db.update를 spy로 캡처 — 발송 성공 시 replyNeeded 갱신을 검증.
// updateWhere를 케이스별로 갈아끼워 post-send DB 실패를 시뮬레이션.
let updateWhere = vi.fn(async () => undefined as unknown);
const updateSet = vi.fn<(values: Record<string, unknown>) => unknown>(() => ({
  where: updateWhere,
}));
const updateMock = vi.fn(() => ({ set: updateSet }));
// 소유권 select는 케이스별로 갈아끼움 (owned vs not-owned).
let ownedRows: { gmailThreadId: string }[] = [];
vi.mock("@/shared/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({ where: () => ({ limit: async () => ownedRows }) }),
      }),
    }),
    update: () => updateMock(),
  },
}));

// gmail 발송 경로 mock — 성공/실패를 케이스별로 제어.
const createDraftMock = vi.fn(async () => ({ draftId: "d1" }));
const sendDraftMock = vi.fn(async () => ({ sentMessageId: "m1" }));
vi.mock("@/shared/api/gmail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/gmail")>();
  return {
    ...actual,
    getValidAccessToken: vi.fn(async () => ({ accessToken: "tok" })),
    createDraft: () => createDraftMock(),
    sendDraft: () => sendDraftMock(),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { sendReply } from "./sendReply";

const META = {
  gmailThreadId: "gt1",
  toEmail: "a@b.com",
  subject: "s",
  inReplyTo: "",
  references: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  ownedRows = [];
  updateWhere = vi.fn(async () => undefined as unknown);
});

describe("sendReply 소유권", () => {
  it("소유하지 않은 threadId → Thread not found throw", async () => {
    ownedRows = [];
    await expect(sendReply("not-owned", "본문", META)).rejects.toThrow(
      "Thread not found",
    );
  });
});

describe("sendReply — 발송 성공 시 replyNeeded 갱신 (#1 답장 재등장 방지)", () => {
  it("발송 성공 시 repliedAt=now, userAction='replied'로 UPDATE한다", async () => {
    ownedRows = [{ gmailThreadId: "gt1" }];

    const result = await sendReply("t1", "본문", META);

    expect(result.kind).toBe("ok");
    // replyNeeded UPDATE가 호출되어야 함 — 안 하면 getReplyNeeded(repliedAt IS NULL)가
    // 답장한 스레드를 새로고침 시 '답장 필요'로 재등장시킨다.
    expect(updateMock).toHaveBeenCalledTimes(1);
    const setArg = updateSet.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(setArg?.userAction).toBe("replied");
    expect(setArg?.repliedAt).toBeInstanceOf(Date);
  });

  it("발송 실패(send-failed) 시 replyNeeded를 갱신하지 않는다", async () => {
    ownedRows = [{ gmailThreadId: "gt1" }];
    sendDraftMock.mockRejectedValueOnce(new Error("network"));

    const result = await sendReply("t1", "본문", META);

    expect(result.kind).toBe("send-failed");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("발송 성공 후 DB 갱신이 실패해도 ok 반환 (double-send 방지)", async () => {
    // 핵심 회귀 가드: 메일은 이미 나갔으므로 bookkeeping 실패가 send-failed로
    // 뒤집히면 사용자가 재발송 → 수신자가 두 번 받는 비가역 사고.
    ownedRows = [{ gmailThreadId: "gt1" }];
    updateWhere = vi.fn(async () => {
      throw new Error("db connection lost");
    });

    const result = await sendReply("t1", "본문", META);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.sentMessageId).toBe("m1");
  });
});
