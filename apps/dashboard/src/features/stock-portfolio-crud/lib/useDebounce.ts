"use client";

import { useEffect, useState } from "react";

/**
 * 입력값을 N ms 만큼 지연시킨 후 반환.
 * autocomplete / 검색 등 사용자 타이핑 부하 완화용.
 */
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
