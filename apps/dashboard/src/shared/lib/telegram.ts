// 텔레그램 발송 — 관제 critical 알림 채널 (이슈 #323 §K).
// TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID 미설정이면 skip. 절대 throw 하지 않는다
// (알림은 best-effort — 관측이 본 작업을 뒤집지 않는 원칙).
import "server-only";
import { env } from "@/shared/config/env";
import { logger } from "@/shared/lib/log";

export type TelegramResult = "sent" | "skipped" | "error";

export async function sendTelegram(text: string): Promise<TelegramResult> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return "skipped";
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) {
      logger.warn("telegram", "send-failed", { status: res.status });
      return "error";
    }
    return "sent";
  } catch (err) {
    logger.warn("telegram", "send-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return "error";
  }
}
