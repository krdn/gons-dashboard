"use client";

// /monitoring 폴링 계층 — router.refresh 로 RSC 재요청 (이슈 #323 §3: 폴링 우선, SSE 후순위).
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAutoRefresh } from "../hooks/useAutoRefresh";

export function AutoRefresh({ intervalMs }: { intervalMs: number }) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  useAutoRefresh(refresh, intervalMs);
  return null;
}
