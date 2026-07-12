"use client";
import { useEffect, useRef, useState } from "react";
import {
  tokenizeSearchQuery,
  SEARCH_MEMOS_LIMIT,
  type Memo,
  type MemoTransformation,
} from "@/entities/memo/client";
// features→features 허용 예외 (검색이 목록 렌더를 재사용).
import { MemoList } from "@/features/memo-manage/ui/MemoList";
import type { TransformPresetOption } from "@/features/memo-transform/client";
import { searchMemosAction } from "../client";

const DEBOUNCE_MS = 300;

type SearchStatus = "searching" | "done" | "failed";

interface SearchableMemoListProps {
  memos: Memo[];
  transformationsByMemo: Record<string, MemoTransformation[]>;
  presets: TransformPresetOption[];
}

// 검색바 + 목록 전환 — 비활성(빈 쿼리)이면 서버가 내려준 원본 목록,
// 활성이면 searchMemosAction 결과(전체 메모 대상, 하이라이트 포함)를 보여준다.
export function SearchableMemoList({ memos, transformationsByMemo, presets }: SearchableMemoListProps) {
  const [query, setQuery] = useState("");
  // null = 아직 첫 응답 전 (검색 중 표시). 재검색 중엔 직전 결과를 유지해 점프를 막는다.
  const [results, setResults] = useState<{ memos: Memo[]; truncated: boolean } | null>(null);
  const [status, setStatus] = useState<SearchStatus>("done");
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 응답 순서 역전 방지 — 마지막 요청만 반영.
  const seqRef = useRef(0);

  const trimmed = query.trim();
  const active = trimmed.length > 0;

  function runSearch(q: string) {
    const seq = ++seqRef.current;
    setStatus("searching");
    searchMemosAction(q).then(
      (r) => {
        if (seq !== seqRef.current) return;
        if (r.kind === "ok") {
          setResults({ memos: r.memos, truncated: r.truncated });
          setStatus("done");
        } else {
          setStatus("failed");
        }
      },
      () => {
        if (seq === seqRef.current) setStatus("failed");
      },
    );
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    const next = value.trim();
    if (next.length === 0) {
      seqRef.current++; // 진행 중 응답 무효화
      setResults(null);
      setStatus("done");
      return;
    }
    timerRef.current = setTimeout(() => runSearch(next), DEBOUNCE_MS);
  }

  // '/' 전역 포커스 단축키 — 다른 입력 필드에 타이핑 중이면 무시.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // unmount 시 디바운스 타이머 정리.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const highlightTerms = active ? tokenizeSearchQuery(trimmed) : [];
  const hasResults = results !== null && results.memos.length > 0;
  // 상태 라인 — 하나의 aria-live 영역이 검색 중·실패·빈 결과·카운트를 모두 알린다.
  const statusText =
    status === "failed"
      ? "검색에 실패했습니다 — 다시 시도해 주세요."
      : results === null
        ? "검색 중…"
        : results.memos.length === 0
          ? `‘${trimmed}’에 대한 결과가 없습니다.`
          : `${results.memos.length}개 결과${results.truncated ? ` · 최근 ${SEARCH_MEMOS_LIMIT}개만 표시` : ""}`;
  const isMessage = status === "failed" || results === null || results.memos.length === 0;

  return (
    <div className="space-y-3">
      <div role="search" className="relative">
        <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm">
          🔍
        </span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={(e) => {
            // IME 조합 중 ESC는 조합 취소 — 검색어까지 지우지 않는다.
            if (e.key === "Escape" && !e.nativeEvent.isComposing && query.length > 0) {
              e.preventDefault();
              handleQueryChange("");
            }
          }}
          placeholder="메모 검색 — 제목·내용·변환본"
          aria-label="메모 검색"
          className="w-full rounded-lg border border-neutral-200 py-2 pl-9 pr-14 text-sm focus:border-neutral-400 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
          {active && status === "searching" && (
            <span
              aria-hidden
              className="h-3.5 w-3.5 animate-spin rounded-full border border-neutral-300 border-t-neutral-700"
            />
          )}
          {query.length > 0 && (
            <button
              type="button"
              onClick={() => handleQueryChange("")}
              aria-label="검색어 지우기"
              className="text-base leading-none text-neutral-400 hover:text-neutral-900"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {active ? (
        <>
          <p
            aria-live="polite"
            className={
              isMessage ? "py-8 text-center text-sm text-neutral-400" : "text-xs text-neutral-400"
            }
          >
            {statusText}
          </p>
          {status !== "failed" && hasResults && (
            <MemoList
              memos={results.memos}
              transformationsByMemo={transformationsByMemo}
              presets={presets}
              highlightTerms={highlightTerms}
              onMutated={() => runSearch(trimmed)}
            />
          )}
        </>
      ) : (
        <MemoList memos={memos} transformationsByMemo={transformationsByMemo} presets={presets} />
      )}
    </div>
  );
}
