import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  stockConsensusFlips,
  pushSubscriptions,
  users,
} from "@/shared/lib/db/schema";
import type { FlipDetection } from "./detect";

// sendPush 는 외부 web-push 네트워크 호출 — 유일하게 fake 가치가 있는 seam.
// notify 의 분기(sent/expired/vapid-missing)를 결정하는 입력이라 mock 으로 제어.
// DB 경로(flip INSERT, dedup, 구독 로드/정리, notified_at)는 실 DB 로 검증.
const sendPushMock = vi.fn();
vi.mock("@/shared/lib/push", () => ({
  sendPush: (...args: unknown[]) => sendPushMock(...args),
}));

import { notifyFlip } from "./notify";

const skipIfNoDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const detection: FlipDetection = {
  symbol: "AAPL",
  fromVerdict: "BUY",
  toVerdict: "SELL",
};

skipIfNoDb("notifyFlip — DB 분기", () => {
  let userId: string;

  beforeEach(async () => {
    sendPushMock.mockReset();
    await db.delete(stockConsensusFlips);
    await db.delete(pushSubscriptions);
    await db.delete(users);
    const [u] = await db
      .insert(users)
      .values({ email: "flip@test.com" })
      .returning();
    userId = u.id;
  });

  async function addSub(endpoint: string) {
    await db.insert(pushSubscriptions).values({
      userId,
      endpoint,
      p256dh: "p256dh-key",
      auth: "auth-key",
    });
  }

  it("구독 없으면 no-subscriptions (flip row 는 INSERT 됨)", async () => {
    const result = await notifyFlip({ userId, detection, displayName: "Apple" });
    expect(result.kind).toBe("no-subscriptions");
    expect(result.flipId).toBeDefined();
    const flips = await db.select().from(stockConsensusFlips);
    expect(flips).toHaveLength(1);
    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it("같은 날 같은 symbol 재호출 → duplicate (dedup unique 위반 캐치)", async () => {
    await addSub("https://push.example/ep1");
    sendPushMock.mockResolvedValue({ kind: "sent" });
    const first = await notifyFlip({ userId, detection, displayName: "Apple" });
    expect(first.kind).toBe("notified");

    const second = await notifyFlip({ userId, detection, displayName: "Apple" });
    expect(second.kind).toBe("duplicate");
    // duplicate 면 두 번째 호출에서 push 발송 안 함 (INSERT 단계에서 중단)
    expect(sendPushMock).toHaveBeenCalledTimes(1);
  });

  it("발송 성공 → notified + notified_at 갱신", async () => {
    await addSub("https://push.example/ep1");
    sendPushMock.mockResolvedValue({ kind: "sent" });
    const result = await notifyFlip({ userId, detection, displayName: "Apple" });
    expect(result.kind).toBe("notified");
    expect(result.notifiedCount).toBe(1);
    const [flip] = await db.select().from(stockConsensusFlips);
    expect(flip.notifiedAt).not.toBeNull();
  });

  it("expired 구독 → 정리(DELETE), notified_at 미갱신", async () => {
    await addSub("https://push.example/expired");
    sendPushMock.mockResolvedValue({ kind: "expired", endpoint: "https://push.example/expired" });
    const result = await notifyFlip({ userId, detection, displayName: "Apple" });
    expect(result.kind).toBe("notified");
    expect(result.notifiedCount).toBe(0);
    // 만료 구독은 DB 에서 제거됨
    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
    expect(subs).toHaveLength(0);
    // 발송 0건이라 notified_at 은 null 유지
    const [flip] = await db.select().from(stockConsensusFlips);
    expect(flip.notifiedAt).toBeNull();
  });

  it("vapid-missing → vapid-missing 반환 (루프 중단)", async () => {
    await addSub("https://push.example/ep1");
    await addSub("https://push.example/ep2");
    sendPushMock.mockResolvedValue({ kind: "vapid-missing" });
    const result = await notifyFlip({ userId, detection, displayName: "Apple" });
    expect(result.kind).toBe("vapid-missing");
    // 첫 발송에서 vapid-missing 감지 → break (두 번째 구독 발송 시도 안 함)
    expect(sendPushMock).toHaveBeenCalledTimes(1);
  });
});
