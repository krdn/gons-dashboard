import { describe, it, expect, vi, afterEach } from "vitest";
import { getMessage } from "./messages";
import { extractMailingListSignals } from "./headers";

afterEach(() => vi.restoreAllMocks());

describe("getMessage metadataHeaders", () => {
  // 회귀 가드: 메일링리스트 1차 컷(isMailingList)의 3개 규칙이 의존하는
  // List-Unsubscribe / List-ID / Precedence 헤더를 실제로 요청해야 한다.
  // Gmail API는 metadataHeaders에 없는 헤더를 응답에 포함하지 않으므로,
  // 이 헤더들이 빠지면 extractMailingListSignals가 항상 false를 반환해
  // 선필터가 죽고 표준 뉴스레터가 전부 LLM 분류기로 넘어간다.
  const fakeMessage = {
    id: "m1",
    threadId: "t1",
    snippet: "hello",
    payload: { headers: [{ name: "From", value: "a@b.com" }] },
  };

  function captureUrl(): { spy: ReturnType<typeof vi.spyOn> } {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(fakeMessage), { status: 200 }));
    return { spy };
  }

  it("format=metadata 로 호출한다", async () => {
    const { spy } = captureUrl();
    await getMessage("token123", "m1");
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("/messages/m1");
    expect(url).toContain("format=metadata");
  });

  it.each(["List-Unsubscribe", "List-ID", "Precedence"])(
    "메일링리스트 신호 헤더 %s 를 metadataHeaders 로 요청한다",
    async (header) => {
      const { spy } = captureUrl();
      await getMessage("token123", "m1");
      const url = spy.mock.calls[0][0] as string;
      // URLSearchParams 인코딩(List-ID → List-ID, 공백 없음)을 고려해 디코드 후 비교.
      const decoded = decodeURIComponent(url);
      expect(decoded).toContain(`metadataHeaders=${header}`);
    },
  );

  it("기존 헤더(From/To/Subject/Date/Reply-To)도 계속 요청한다", async () => {
    const { spy } = captureUrl();
    await getMessage("token123", "m1");
    const decoded = decodeURIComponent(spy.mock.calls[0][0] as string);
    for (const h of ["From", "To", "Subject", "Date", "Reply-To"]) {
      expect(decoded).toContain(`metadataHeaders=${h}`);
    }
  });
});

describe("extractMailingListSignals (통합 회귀)", () => {
  // headers.ts 와 messages.ts 의 wiring 이 맞는지 — 실제 fetch 응답 헤더가
  // 채워졌을 때 신호가 true 로 추출되는지 확인. (단위 격리가 아닌 fetch→파싱→추출 경로)
  it("List-Unsubscribe 헤더가 응답에 오면 hasListUnsubscribe=true", async () => {
    const msgWithLU = {
      id: "m2",
      threadId: "t2",
      snippet: "newsletter",
      payload: {
        headers: [
          { name: "From", value: "news@example.com" },
          { name: "List-Unsubscribe", value: "<https://example.com/unsub>" },
        ],
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(msgWithLU), { status: 200 }),
    );

    const msg = await getMessage("token123", "m2");
    const signals = extractMailingListSignals(msg.payload?.headers);

    expect(signals.hasListUnsubscribe).toBe(true);
  });
});
