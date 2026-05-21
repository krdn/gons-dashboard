// notifyFlip — flip 감지 후 stock_consensus_flips INSERT + user push subscriptions 발송.
// 24h dedup unique index 가 같은 (user, symbol, detected_at::date) 중복 차단 → catch + 'duplicate' 반환.
import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  stockConsensusFlips,
  pushSubscriptions,
} from "@/shared/lib/db/schema";
import { sendPush } from "@/shared/lib/push";
import type { FlipDetection } from "./detect";

const FLIP_TITLE: Record<string, string> = {
  "BUY→HOLD": "합의 전환: 매수 → 보유",
  "BUY→SELL": "합의 전환: 매수 → 매도",
  "HOLD→BUY": "합의 전환: 보유 → 매수",
  "HOLD→SELL": "합의 전환: 보유 → 매도",
  "SELL→BUY": "합의 전환: 매도 → 매수",
  "SELL→HOLD": "합의 전환: 매도 → 보유",
};

export interface NotifyResult {
  kind: "notified" | "duplicate" | "no-subscriptions" | "vapid-missing";
  flipId?: string;
  notifiedCount?: number;
}

export async function notifyFlip(args: {
  userId: string;
  detection: FlipDetection;
  displayName: string;
}): Promise<NotifyResult> {
  // 1. flip row INSERT — 24h dedup partial unique index 가 같은 날 중복 차단.
  let flipRow: { id: string } | null = null;
  try {
    const [row] = await db
      .insert(stockConsensusFlips)
      .values({
        userId: args.userId,
        symbol: args.detection.symbol,
        fromVerdict: args.detection.fromVerdict,
        toVerdict: args.detection.toVerdict,
      })
      .returning({ id: stockConsensusFlips.id });
    flipRow = row;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("flips_dedup_uq")) {
      return { kind: "duplicate" };
    }
    throw err;
  }

  // 2. user subscriptions 로드.
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, args.userId));

  if (subs.length === 0) {
    return { kind: "no-subscriptions", flipId: flipRow.id };
  }

  // 3. web-push 발송 (직렬 — VAPID rate-limit 친화).
  const key = `${args.detection.fromVerdict}→${args.detection.toVerdict}`;
  const title = FLIP_TITLE[key] ?? `${args.detection.symbol} 합의 전환`;
  const body = `${args.displayName}: ${args.detection.fromVerdict} → ${args.detection.toVerdict} (본 알림은 LLM 가상 의견이며 투자 자문이 아닙니다)`;

  let notifiedCount = 0;
  const expiredEndpoints: string[] = [];
  let vapidMissing = false;

  for (const sub of subs) {
    const result = await sendPush(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      {
        title,
        body,
        url: `/?symbol=${args.detection.symbol}`,
        tag: `flip-${args.detection.symbol}`,
      },
    );
    if (result.kind === "sent") {
      notifiedCount += 1;
    } else if (result.kind === "expired") {
      expiredEndpoints.push(result.endpoint);
    } else if (result.kind === "vapid-missing") {
      vapidMissing = true;
      break;
    }
  }

  // 4. 만료된 구독 정리.
  if (expiredEndpoints.length > 0) {
    for (const ep of expiredEndpoints) {
      await db
        .delete(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, ep));
    }
  }

  // 5. notified_at 갱신 (적어도 1건 발송 성공이면 마킹).
  if (notifiedCount > 0) {
    await db
      .update(stockConsensusFlips)
      .set({ notifiedAt: new Date() })
      .where(eq(stockConsensusFlips.id, flipRow.id));
  }

  if (vapidMissing) return { kind: "vapid-missing", flipId: flipRow.id };
  return { kind: "notified", flipId: flipRow.id, notifiedCount };
}
