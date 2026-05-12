// syncInbox — 받은편지함 동기화의 5가지 분기 + dedup 동작 검증.
//
// 분기:
//   1. reauth-required (getValidAccessToken → InvalidGrantError)
//   2. ok-first-sync (users.lastHistoryId === null → fullRescan)
//   3. ok-incremental (refs 0개 → historyId만 갱신)
//   4. ok-incremental (refs N개 → fetch + upsert + classify)
//   5. ok-full-rescan (listHistorySince → HistoryStaleError → fullRescan fallback)
//
// 추가 케이스:
//   - dedup: 같은 threadId의 두 메시지가 들어오면 latest internalDate 만 보존.
//
// CRITICAL: partial mock 사용. `vi.mock("@/shared/api/gmail", async (importOriginal))` 로
// InvalidGrantError / HistoryStaleError 클래스 instanceof 체크 보존.
// 전체 mock 으로 대체하면 instanceof 가 silently false 되어 분기가 throw 로 새어나간다.
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// classifyThreadsLoop / fullRescan / Gmail API 의 외부 통신 부분만 mock.
vi.mock("@/features/gmail-sync/lib/full-rescan", () => ({
  fullRescan: vi.fn(),
}));
vi.mock("@/features/gmail-sync/lib/classifyThreadsLoop", () => ({
  classifyThreadsLoop: vi.fn(),
}));
vi.mock("@/shared/api/gmail", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/shared/api/gmail")>();
  return {
    ...real, // InvalidGrantError, HistoryStaleError, extractMailingListSignals, findHeader 등 보존
    getValidAccessToken: vi.fn(),
    listHistorySince: vi.fn(),
    getMessage: vi.fn(),
  };
});

import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { users, emailThreads } from "@/shared/lib/db/schema";
import {
  getValidAccessToken,
  listHistorySince,
  getMessage,
  InvalidGrantError,
  HistoryStaleError,
  type MessageDetail,
} from "@/shared/api/gmail";
import { fullRescan } from "@/features/gmail-sync/lib/full-rescan";
import { classifyThreadsLoop } from "@/features/gmail-sync/lib/classifyThreadsLoop";
import { syncInbox } from "@/features/gmail-sync/api/syncInbox";

const RUN_PREFIX = `sync-${Date.now()}`;

const mockedGetToken = getValidAccessToken as ReturnType<typeof vi.fn>;
const mockedListHistory = listHistorySince as ReturnType<typeof vi.fn>;
const mockedGetMessage = getMessage as ReturnType<typeof vi.fn>;
const mockedFullRescan = fullRescan as ReturnType<typeof vi.fn>;
const mockedClassify = classifyThreadsLoop as ReturnType<typeof vi.fn>;

let userId: string;

beforeAll(async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `${RUN_PREFIX}@example.com` })
    .returning({ id: users.id });
  userId = u.id;
});

beforeEach(async () => {
  mockedGetToken.mockReset();
  mockedListHistory.mockReset();
  mockedGetMessage.mockReset();
  mockedFullRescan.mockReset();
  mockedClassify.mockReset();

  // 기본: token OK, classify 0건.
  mockedGetToken.mockResolvedValue({ accessToken: "tok-test" });
  mockedClassify.mockResolvedValue({
    classified: 0,
    skipped: 0,
    importantOutcomes: {},
    importantConsidered: 0,
  });

  // 매 테스트마다 user 의 lastHistoryId 초기화 (이전 테스트 영향 차단).
  await db
    .update(users)
    .set({ lastHistoryId: null, lastSyncAt: null })
    .where(eq(users.id, userId));
  // 이전 테스트가 남긴 thread row 제거.
  await db.delete(emailThreads).where(eq(emailThreads.userId, userId));
});

function makeMessage(
  threadId: string,
  internalDate: number,
  overrides: Partial<MessageDetail> = {},
): MessageDetail {
  return {
    id: `m-${threadId}-${internalDate}`,
    threadId,
    internalDate: String(internalDate),
    snippet: `snippet-${internalDate}`,
    payload: {
      headers: [
        { name: "From", value: '"Sender" <s@example.com>' },
        { name: "Subject", value: `Subject ${internalDate}` },
      ],
    },
    ...overrides,
  } as MessageDetail;
}

describe("syncInbox", () => {
  it("reauth-required: getValidAccessToken 이 InvalidGrantError 면 즉시 반환", async () => {
    mockedGetToken.mockRejectedValueOnce(new InvalidGrantError("revoked"));

    const result = await syncInbox(userId);

    expect(result.kind).toBe("reauth-required");
    expect(mockedListHistory).not.toHaveBeenCalled();
    expect(mockedFullRescan).not.toHaveBeenCalled();
  });

  it("ok-first-sync: lastHistoryId 가 null 이면 fullRescan 호출", async () => {
    mockedFullRescan.mockResolvedValueOnce({
      newHistoryId: "hist-100",
      threadCount: 5,
      messageCount: 7,
    });

    const result = await syncInbox(userId);

    expect(result.kind).toBe("ok-first-sync");
    expect(result.newHistoryId).toBe("hist-100");
    expect(result.newThreadCount).toBe(5);
    expect(mockedFullRescan).toHaveBeenCalledOnce();
    expect(mockedListHistory).not.toHaveBeenCalled();

    // DB 에 historyId 가 반영됐는지 확인.
    const [u] = await db
      .select({ lastHistoryId: users.lastHistoryId })
      .from(users)
      .where(eq(users.id, userId));
    expect(u.lastHistoryId).toBe("hist-100");
  });

  it("ok-incremental (no new): listHistorySince refs 0개 → historyId 만 갱신", async () => {
    // 사전 lastHistoryId 설정.
    await db
      .update(users)
      .set({ lastHistoryId: "hist-50" })
      .where(eq(users.id, userId));

    mockedListHistory.mockResolvedValueOnce({
      newMessageRefs: [],
      newHistoryId: "hist-60",
    });

    const result = await syncInbox(userId);

    expect(result.kind).toBe("ok-incremental");
    expect(result.newThreadCount).toBe(0);
    expect(mockedGetMessage).not.toHaveBeenCalled();
    expect(mockedFullRescan).not.toHaveBeenCalled();

    const [u] = await db
      .select({ lastHistoryId: users.lastHistoryId })
      .from(users)
      .where(eq(users.id, userId));
    expect(u.lastHistoryId).toBe("hist-60");
  });

  it("ok-incremental (with new): refs 가 있으면 fetch + upsert + classify 호출", async () => {
    await db
      .update(users)
      .set({ lastHistoryId: "hist-50" })
      .where(eq(users.id, userId));

    mockedListHistory.mockResolvedValueOnce({
      newMessageRefs: [
        { id: "msg-1", threadId: `${RUN_PREFIX}-thread-A` },
      ],
      newHistoryId: "hist-70",
    });
    mockedGetMessage.mockResolvedValueOnce(
      makeMessage(`${RUN_PREFIX}-thread-A`, Date.now()),
    );
    mockedClassify.mockResolvedValueOnce({
      classified: 1,
      skipped: 0,
      importantOutcomes: { classified: 1 },
      importantConsidered: 1,
    });

    const result = await syncInbox(userId);

    expect(result.kind).toBe("ok-incremental");
    expect(result.newThreadCount).toBe(1);
    expect(result.classifiedCount).toBe(1);
    expect(mockedGetMessage).toHaveBeenCalledOnce();

    // DB 에 thread upsert 검증.
    const rows = await db
      .select()
      .from(emailThreads)
      .where(eq(emailThreads.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].gmailThreadId).toBe(`${RUN_PREFIX}-thread-A`);
    expect(rows[0].lastSenderEmail).toBe("s@example.com");
  });

  it("ok-full-rescan: listHistorySince 가 HistoryStaleError 면 fullRescan 으로 fallback", async () => {
    await db
      .update(users)
      .set({ lastHistoryId: "hist-stale" })
      .where(eq(users.id, userId));

    mockedListHistory.mockRejectedValueOnce(new HistoryStaleError("404 historyId"));
    mockedFullRescan.mockResolvedValueOnce({
      newHistoryId: "hist-200",
      threadCount: 10,
      messageCount: 12,
    });

    const result = await syncInbox(userId);

    expect(result.kind).toBe("ok-full-rescan");
    expect(result.newHistoryId).toBe("hist-200");
    expect(result.newThreadCount).toBe(10);
    expect(mockedFullRescan).toHaveBeenCalledOnce();
  });

  it("dedup: 같은 threadId 의 두 메시지 중 newer internalDate 만 보존", async () => {
    await db
      .update(users)
      .set({ lastHistoryId: "hist-50" })
      .where(eq(users.id, userId));

    const threadId = `${RUN_PREFIX}-dedup-thread`;
    const olderTs = Date.now() - 60 * 60 * 1000; // 1h 전
    const newerTs = Date.now(); // 지금

    mockedListHistory.mockResolvedValueOnce({
      newMessageRefs: [
        { id: "msg-older", threadId },
        { id: "msg-newer", threadId },
      ],
      newHistoryId: "hist-71",
    });
    // 두 메시지 fetch — older 가 먼저, newer 가 나중 (순서 무관해야 함).
    mockedGetMessage
      .mockResolvedValueOnce(
        makeMessage(threadId, olderTs, {
          snippet: "older-snippet",
          payload: {
            headers: [
              { name: "From", value: "old@example.com" },
              { name: "Subject", value: "Old Subject" },
            ],
          },
        } as Partial<MessageDetail>),
      )
      .mockResolvedValueOnce(
        makeMessage(threadId, newerTs, {
          snippet: "newer-snippet",
          payload: {
            headers: [
              { name: "From", value: "new@example.com" },
              { name: "Subject", value: "New Subject" },
            ],
          },
        } as Partial<MessageDetail>),
      );

    const result = await syncInbox(userId);

    expect(result.kind).toBe("ok-incremental");
    expect(result.newThreadCount).toBe(1); // dedup 된 1개

    // DB 에 한 행만 있고 newer 의 메타가 들어갔는지.
    const rows = await db
      .select()
      .from(emailThreads)
      .where(eq(emailThreads.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].snippet).toBe("newer-snippet");
    expect(rows[0].subject).toBe("New Subject");
    expect(rows[0].lastSenderEmail).toBe("new@example.com");
  });
});
