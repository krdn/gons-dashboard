// important 트랙 통합 가드 — classifyImportantThread 가 실제로 signals 를 받아
// 메일링 컷을 수행하는가. eval Layer 1(isMailingList 격리 호출)·Layer 2(컷 skip)
// 어디도 안 밟는 통합 지점 — reclassify signals-drop(#②)·헤더 누락(#①) 버그가
// 여기 없으면 invisible 했다(audit §5 #21).
//
// 핵심: signals 가 채워지면 컷(skipped-mailing-list, DB/LLM 미접근),
//       signals 가 비면 컷이 죽어 DB 로 진행 — 두 outcome 의 차이가 증명.
import { describe, it, expect, vi } from "vitest";

// db 는 case B(컷 안 됨)에서만 닿는다 — thread 없음 → skipped-already.
vi.mock("@/shared/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [], // thread row 없음
        }),
      }),
    }),
  },
}));

import { classifyImportantThread } from "@/entities/email/api/classifyImportant";
import type { ImportantInput } from "@/entities/email/model/types";
import type { MailingListSignals } from "@/shared/api/gmail";

const EMPTY_SIGNALS: MailingListSignals = {
  hasListUnsubscribe: false,
  hasListId: false,
  precedence: null,
  fromHeader: null,
};

const input: ImportantInput = {
  subject: "주간 뉴스레터",
  snippet: "이번 주 소식입니다",
  fromName: "Newsletter",
  fromEmail: "news@example.com",
  receivedAtKst: "2026-06-18 14:30 KST",
};

describe("important 트랙 메일링 컷 통합", () => {
  it("List-Unsubscribe signals 채워지면 컷 (skipped-mailing-list, DB 미접근)", async () => {
    const outcome = await classifyImportantThread({
      userId: "u1",
      threadId: "t1",
      input,
      signals: { ...EMPTY_SIGNALS, hasListUnsubscribe: true },
    });
    expect(outcome.kind).toBe("skipped-mailing-list");
  });

  it("List-ID signals 채워지면 컷", async () => {
    const outcome = await classifyImportantThread({
      userId: "u1",
      threadId: "t1",
      input,
      signals: { ...EMPTY_SIGNALS, hasListId: true },
    });
    expect(outcome.kind).toBe("skipped-mailing-list");
  });

  it("signals 가 비면 컷이 죽어 DB 로 진행 — skipped-mailing-list 아님", async () => {
    // 같은 메일인데 signals 만 빠짐(=reclassify #② / 헤더 누락 #① 버그 재현).
    const outcome = await classifyImportantThread({
      userId: "u1",
      threadId: "t1",
      input,
      signals: EMPTY_SIGNALS,
    });
    // 컷이 안 일어났음을 증명 — DB 경로로 빠져 skipped-already(thread 없음).
    expect(outcome.kind).not.toBe("skipped-mailing-list");
    expect(outcome.kind).toBe("skipped-already");
  });
});
