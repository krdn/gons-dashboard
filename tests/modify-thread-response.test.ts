// modifyThread 응답 파싱 — Gmail threads.modify 실제 응답 shape 회귀 방지.
//
// 과거 회귀: Zod 스키마가 messages.modify 응답(`{id, threadId, labelIds}`)을
// 기대했으나 코드는 threads.modify 엔드포인트를 호출. 실제 응답에 `threadId`
// 필드 없음 → ZodError → "읽음"/"보관" 액션 silent fail.
//
// 본 테스트는 Gmail 공식 문서의 threads.modify 응답 형태 4가지를 통과시킨다.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

let modifyThread: typeof import("../src/shared/api/gmail/modify").modifyThread;

beforeEach(async () => {
  mockFetch.mockReset();
  ({ modifyThread } = await import("../src/shared/api/gmail/modify"));
});

describe("modifyThread response parsing", () => {
  it("최소 응답 (id 만) 도 통과", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "thread-1" }),
    });
    await expect(
      modifyThread("token", "thread-1", { removeLabelIds: ["UNREAD"] }),
    ).resolves.toMatchObject({ id: "thread-1" });
  });

  it("Gmail threads.modify 실제 응답 shape (id + historyId + messages)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "thread-1",
        historyId: "12345",
        messages: [{ id: "msg-1", threadId: "thread-1", labelIds: ["INBOX"] }],
      }),
    });
    await expect(
      modifyThread("token", "thread-1", { removeLabelIds: ["UNREAD"] }),
    ).resolves.toMatchObject({ id: "thread-1" });
  });

  it("threadId 필드 누락해도 통과 (이전 회귀 회귀)", async () => {
    // 핵심: 옛 스키마는 threadId 를 required 로 두어 ZodError 발생했음.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "thread-1", historyId: "999" }),
    });
    await expect(
      modifyThread("token", "thread-1", { removeLabelIds: ["UNREAD"] }),
    ).resolves.toMatchObject({ id: "thread-1" });
  });

  it("id 누락 응답은 ZodError 로 reject (스키마 약화 한도)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ historyId: "999", messages: [] }),
    });
    await expect(
      modifyThread("token", "thread-1", { removeLabelIds: ["UNREAD"] }),
    ).rejects.toThrow();
  });
});
