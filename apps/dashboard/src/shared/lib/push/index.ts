// Web Push 발송 — VAPID 키 기반 standard.
//
// 구독 정보(endpoint, p256dh, auth)는 push_subscriptions 테이블에서.
// VAPID 키는 .env (없으면 실질적으로 push 비활성).
import "server-only";
import webpush from "web-push";
import { eq } from "drizzle-orm";
import { env } from "@/shared/config/env";
import { db } from "@/shared/lib/db/client";
import { pushSubscriptions } from "@/shared/lib/db/schema";

let vapidConfigured = false;

function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  if (
    !env.VAPID_PUBLIC_KEY ||
    !env.VAPID_PRIVATE_KEY ||
    !env.VAPID_SUBJECT
  ) {
    return false;
  }
  webpush.setVapidDetails(
    env.VAPID_SUBJECT,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  );
  vapidConfigured = true;
  return true;
}

export interface PushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export type PushResult =
  | { kind: "sent" }
  | { kind: "vapid-missing" }
  | { kind: "expired"; endpoint: string } // 호출자가 DB에서 제거할 것
  | { kind: "error"; error: string };

export interface SendPushToUserResult {
  total: number;
  sent: number;
  expired: number;
  errors: number;
}

/**
 * userId의 전 구독에 직렬 발송 + 만료(404/410) 구독 정리까지 처리하는 헬퍼.
 * notifyFlip·morning-digest가 각자 복붙하던 관례를 승격 — 신규 호출자용
 * (기존 호출자 마이그레이션은 비범위, 스펙 2026-07-12-memo-weekly-digest §7).
 * 구독 0건은 에러가 아니다 — total=0으로 조용히 반환 (관례).
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<SendPushToUserResult> {
  const subs = await db
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));

  let sent = 0;
  let expired = 0;
  let errors = 0;
  const expiredEndpoints: string[] = [];

  // 직렬 발송 — VAPID rate-limit 친화 (관례: Promise.all 병렬 금지).
  for (const sub of subs) {
    const result = await sendPush(sub, payload);
    if (result.kind === "sent") sent += 1;
    else if (result.kind === "expired") {
      expired += 1;
      expiredEndpoints.push(result.endpoint);
    } else if (result.kind === "error") errors += 1;
    else break; // vapid-missing — 나머지도 동일하므로 중단 (notifyFlip 패턴)
  }

  for (const endpoint of expiredEndpoints) {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  }

  return { total: subs.length, sent, expired, errors };
}

export async function sendPush(
  sub: PushSubscription,
  payload: PushPayload,
): Promise<PushResult> {
  if (!ensureVapid()) return { kind: "vapid-missing" };

  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload),
      { TTL: 6 * 60 * 60 }, // 6시간 — 디지스트 알림이 너무 늦게 도달하면 무의미
    );
    return { kind: "sent" };
  } catch (error) {
    const status =
      typeof error === "object" && error !== null && "statusCode" in error
        ? Number((error as { statusCode: unknown }).statusCode)
        : 0;
    if (status === 404 || status === 410) {
      return { kind: "expired", endpoint: sub.endpoint };
    }
    const message = error instanceof Error ? error.message : "unknown";
    return { kind: "error", error: message };
  }
}
