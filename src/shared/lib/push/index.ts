// Web Push 발송 — VAPID 키 기반 standard.
//
// 구독 정보(endpoint, p256dh, auth)는 push_subscriptions 테이블에서.
// VAPID 키는 .env (없으면 실질적으로 push 비활성).
import "server-only";
import webpush from "web-push";
import { env } from "@/shared/config/env";

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
