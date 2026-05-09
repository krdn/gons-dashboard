// Push 구독 토글 버튼 — 클라이언트 컴포넌트.
//
// v0.1: 단순 ON/OFF. UI는 footer 영역에 작게.
// v0.2에서 sub 상태 정교한 표시 (이미 구독, 권한 거부됨 등).
"use client";

import { useEffect, useState, useTransition } from "react";

type PushState =
  | "checking"
  | "unsupported"
  | "permission-denied"
  | "not-subscribed"
  | "subscribed";

export function PushSubscribeButton() {
  const [state, setState] = useState<PushState>("checking");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    const detect = async () => {
      if (typeof window === "undefined") return;
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (!cancelled) setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setState("permission-denied");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setState(sub ? "subscribed" : "not-subscribed");
      } catch {
        if (!cancelled) setState("not-subscribed");
      }
    };
    void detect();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubscribe = () => {
    startTransition(async () => {
      try {
        // 등록되어 있지 않으면 등록.
        const reg =
          (await navigator.serviceWorker.getRegistration("/sw.js")) ??
          (await navigator.serviceWorker.register("/sw.js"));

        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setState("permission-denied");
          return;
        }

        const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!publicKey) {
          console.warn("VAPID public key 미설정");
          return;
        }

        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          // BufferSource 타입 호환을 위해 .buffer로 ArrayBuffer 전달.
          applicationServerKey: urlBase64ToUint8Array(publicKey)
            .buffer as ArrayBuffer,
        });

        const json = sub.toJSON() as {
          endpoint: string;
          keys?: { p256dh?: string; auth?: string };
        };
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: json.endpoint,
            keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
          }),
        });
        setState("subscribed");
      } catch (error) {
        console.error("구독 실패", error);
      }
    });
  };

  const handleUnsubscribe = () => {
    startTransition(async () => {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("not-subscribed");
    });
  };

  if (state === "checking") return null;
  if (state === "unsupported") {
    return (
      <p className="text-xs text-[var(--color-text-subtle)]">
        이 브라우저는 푸시 알림을 지원하지 않습니다.
      </p>
    );
  }
  if (state === "permission-denied") {
    return (
      <p className="text-xs text-[var(--color-text-subtle)]">
        브라우저 알림 권한이 차단되어 있습니다. 브라우저 설정에서 허용 후 다시
        시도하세요.
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={state === "subscribed" ? handleUnsubscribe : handleSubscribe}
      disabled={isPending}
      className="text-xs font-medium text-[var(--color-text-muted)] underline underline-offset-2 hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
    >
      {state === "subscribed"
        ? "아침 8시 알림 끄기"
        : "아침 8시 알림 켜기"}
    </button>
  );
}

/**
 * VAPID public key (base64url) → Uint8Array.
 * subscribe applicationServerKey 표준 변환.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}
