"use client";

// 일정 간격으로 콜백 호출. Next.js router.refresh 같은 RSC 재요청에 적합.
// cleanup 보장.
import { useEffect } from "react";

export function useAutoRefresh(callback: () => void, intervalMs: number): void {
  useEffect(() => {
    const id = window.setInterval(callback, intervalMs);
    return () => window.clearInterval(id);
  }, [callback, intervalMs]);
}
