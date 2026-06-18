// listHistorySince — maxPages 절단 시 silent 데이터 손실 관찰성.
// pageToken 이 남은 채 maxPages 도달하면 미fetch 페이지가 버려지므로 logger.warn.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const warn = vi.fn();
vi.mock("@/shared/lib/log", () => ({
  logger: { warn: (...args: unknown[]) => warn(...args), error: vi.fn(), info: vi.fn() },
}));

import { listHistorySince } from "@/shared/api/gmail/history";

const fetchSpy = vi.spyOn(globalThis, "fetch");

function page(nextPageToken: string | undefined): Response {
  return new Response(
    JSON.stringify({
      history: [{ id: "1", messagesAdded: [] }],
      historyId: "999",
      ...(nextPageToken ? { nextPageToken } : {}),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

beforeEach(() => {
  warn.mockClear();
});
afterEach(() => {
  fetchSpy.mockReset();
});

describe("listHistorySince — maxPages 절단 경고", () => {
  it("pageToken 남은 채 maxPages 도달 → maxpages-truncated 경고", async () => {
    // 매 호출마다 새 Response — body 는 일회성 스트림이라 재사용 불가.
    fetchSpy.mockImplementation(async () => page("more"));
    await listHistorySince("token", "100", 2);
    expect(warn).toHaveBeenCalledWith(
      "gmail/history",
      "maxpages-truncated",
      expect.objectContaining({ maxPages: 2 }),
    );
  });

  it("pageToken 소진(절단 없음) → 경고 없음", async () => {
    // 첫 페이지에서 nextPageToken 없음 → 정상 종료.
    fetchSpy.mockResolvedValueOnce(page(undefined));
    await listHistorySince("token", "100", 20);
    expect(warn).not.toHaveBeenCalled();
  });
});
