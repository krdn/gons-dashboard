"use client";

import { useEffect, useState } from "react";
import type { SearchResult } from "@/entities/stock/client";
import { useDebounce } from "../lib/useDebounce";

interface Props {
  onSelect: (result: SearchResult) => void;
  placeholder?: string;
}

export function TickerSearchInput({
  onSelect,
  placeholder = "종목명 또는 티커 검색 (예: AAPL, 삼성전자)",
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const debouncedQuery = useDebounce(query, 300);
  const hasQuery = debouncedQuery.trim().length > 0;
  const open = focused && hasQuery && results.length > 0;

  useEffect(() => {
    if (!hasQuery) {
      // 빈 쿼리는 fetch 호출 안 함. results 표시는 hasQuery 게이트로 차단됨.
      return;
    }
    const controller = new AbortController();
    void (async () => {
      // setState 는 effect body 동기 호출 금지 — async IIFE 안에서만.
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/stock/search?q=${encodeURIComponent(debouncedQuery)}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error(`검색 실패 (${res.status})`);
        const data = (await res.json()) as { results: SearchResult[] };
        setResults(data.results);
        setLoading(false);
      } catch (err) {
        // AbortError 는 의도된 취소 — 에러 표시하지 않음.
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message = err instanceof Error ? err.message : "검색 실패";
        setError(message);
        setResults([]);
        setLoading(false);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [debouncedQuery, hasQuery]);

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2 text-sm focus:border-[var(--color-accent)] focus:outline-none"
      />
      {loading && (
        <div className="absolute right-3 top-2 text-xs text-[var(--color-text-muted)]">
          검색 중…
        </div>
      )}
      {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
      {open && (
        <ul className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] shadow-lg">
          {results.map((r) => (
            <li
              key={r.symbol}
              onMouseDown={(e) => {
                // onBlur(focused=false)이 onClick보다 먼저 발생해 dropdown이 닫히는 것을 방지.
                e.preventDefault();
                onSelect(r);
                setQuery(r.displayName);
                setFocused(false);
              }}
              className="cursor-pointer border-b border-[var(--color-hairline)] px-3 py-2 text-sm last:border-b-0 hover:bg-[var(--color-surface-2)]"
            >
              <div className="flex items-baseline justify-between">
                <strong className="font-semibold">{r.displayName}</strong>
                <span className="text-xs text-[var(--color-text-muted)]">
                  {r.symbol} · {r.exchange}
                </span>
              </div>
              <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                {r.assetClass} · {r.market}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
