// shared/api/gmail/history — listHistorySince 의 404 endpoint-aware 변환.
//
// Regression: Google 의 stale historyId 404 메시지가 "Requested entity was not found." 처럼
// 변경되어도 endpoint+status 기반 분류라 HistoryStaleError 로 회복.
// 이전 regex (`history.*not found|invalid.*history`) 는 이 문구를 놓쳐 cron 이 4일간 stale.
import { describe, it, expect, vi, afterEach } from "vitest";
import { listHistorySince } from "@/shared/api/gmail/history";
import { HistoryStaleError } from "@/shared/api/gmail/errors";

const fetchSpy = vi.spyOn(globalThis, "fetch");

afterEach(() => {
  fetchSpy.mockReset();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("listHistorySince — endpoint-aware 404", () => {
  it("Google 의 'Requested entity was not found.' 메시지도 HistoryStaleError 로 변환", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(404, {
        error: {
          message: "Requested entity was not found.",
          errors: [{ reason: "notFound" }],
        },
      }),
    );

    await expect(
      listHistorySince("token", "43011717"),
    ).rejects.toBeInstanceOf(HistoryStaleError);
  });

  it("기존 'historyId not found' 메시지도 HistoryStaleError 로 변환 (역호환)", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(404, {
        error: {
          message: "Requested entity was not found: historyId not found",
          errors: [{ reason: "notFound" }],
        },
      }),
    );

    await expect(
      listHistorySince("token", "43011717"),
    ).rejects.toBeInstanceOf(HistoryStaleError);
  });
});
