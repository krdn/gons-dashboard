"use client";

// 일정 간격으로 콜백 호출 — host-dashboard 훅의 로컬 복제
// (위젯 간 직접 import 는 FSD 경계 위반이라 12줄 복제를 택함).
import { useEffect } from "react";

export function useAutoRefresh(callback: () => void, intervalMs: number): void {
  useEffect(() => {
    const id = window.setInterval(callback, intervalMs);
    return () => window.clearInterval(id);
  }, [callback, intervalMs]);
}
