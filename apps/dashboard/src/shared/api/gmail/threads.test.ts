import { describe, it, expect, vi, afterEach } from "vitest";
import { getThread } from "./threads";

afterEach(() => vi.restoreAllMocks());

describe("getThread", () => {
  it("threads.get format=full 호출 + messages 반환", async () => {
    const fakeThread = {
      id: "t1",
      messages: [
        {
          id: "m1",
          threadId: "t1",
          payload: {
            mimeType: "text/plain",
            headers: [{ name: "From", value: "test@example.com" }],
          },
        },
      ],
    };

    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(fakeThread), { status: 200 }),
    );

    const result = await getThread("token123", "t1");

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].id).toBe("m1");

    const calledUrl = spy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/threads/t1");
    expect(calledUrl).toContain("format=full");
  });

  it("API 에러 시 분류된 에러 throw", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Invalid thread ID" } }), {
        status: 400,
      }),
    );

    await expect(getThread("token123", "invalid")).rejects.toThrow();
  });

  it("재시도 가능 에러 시 exponential backoff 후 재시도", async () => {
    const spy = vi.spyOn(globalThis, "fetch");

    // 첫 2번은 429, 3번째는 성공
    const fakeThread = { id: "t1", messages: [] };
    spy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Rate limit" } }), {
          status: 429,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Rate limit" } }), {
          status: 429,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(fakeThread), { status: 200 }),
      );

    const result = await getThread("token123", "t1");

    expect(result.id).toBe("t1");
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("최대 재시도 초과 시 마지막 에러 throw", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Server error" } }), {
        status: 500,
      }),
    );

    await expect(getThread("token123", "t1")).rejects.toThrow();
  });
});
