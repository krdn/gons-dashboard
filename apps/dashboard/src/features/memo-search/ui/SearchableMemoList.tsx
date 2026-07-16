"use client";
import { useEffect, useRef, useState } from "react";
import {
  tokenizeSearchQuery,
  SEARCH_MEMOS_LIMIT,
  type Memo,
  type MemoActionItem,
  type MemoCategory,
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
  /** 사용자 전체 액션 맵 — 검색 결과(200개 컷 밖 메모)에도 유효 (transformationsByMemo와 동일 원리). */
  actionItemsByMemo?: Record<string, MemoActionItem[]>;
  /** 등록된 카테고리 목록 — 필터 칩·라벨 조회 (DB memo_categories, 서버 로드). */
  categories: { id: string; labelKo: string }[];
}

// 검색바 + 목록 전환 — 검색어·카테고리 필터가 모두 비면 서버가 내려준 원본 목록,
// 하나라도 걸리면 searchMemosAction 결과(전체 메모 대상, 서버 WHERE 필터)를 보여준다.
// 카테고리를 클라이언트 .filter로 거르면 LIMIT 컷 밖 메모가 가려져 false-empty가 난다.
export function SearchableMemoList({
  memos,
  transformationsByMemo,
  presets,
  actionItemsByMemo,
  categories,
}: SearchableMemoListProps) {
  const [query, setQuery] = useState("");
  // null = 아직 첫 응답 전 (검색 중 표시). 재검색 중엔 직전 결과를 유지해 점프를 막는다.
  const [results, setResults] = useState<{ memos: Memo[]; truncated: boolean } | null>(null);
  const [status, setStatus] = useState<SearchStatus>("done");
  // 카테고리 필터 — 서버 WHERE 조건으로 전달. null = 전체.
  const [category, setCategory] = useState<MemoCategory | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 응답 순서 역전 방지 — 마지막 요청만 반영.
  const seqRef = useRef(0);

  const categoryLabels: Record<string, string> = Object.fromEntries(
    categories.map((c) => [c.id, c.labelKo]),
  );
  const labelOf = (id: string) => categoryLabels[id] ?? id;

  const trimmed = query.trim();
  const active = trimmed.length > 0;
  // 서버 조회 모드 — 검색어 또는 카테고리 필터가 하나라도 걸려 있으면 results를 쓴다.
  const fetchMode = active || category !== null;

  // mutation 완료 시점의 "현재" 필터 — 렌더 시점 클로저(trimmed/category)를 onMutated에
  // 캡처하면, 지연된 mutation 콜백이 과거 필터 조회를 더 높은 seq로 시작해
  // 사용자가 옮겨간 필터의 응답을 무효화한다 (B 칩 활성인데 A 목록 표시).
  // 갱신은 passive effect가 아니라 두 입력 핸들러에서 동기 기록 — effect 실행 전에
  // mutation이 완료되는 좁은 창까지 닫는다 (Codex 재판정 반영).
  const filterRef = useRef({ trimmed, category });

  function refreshCurrent() {
    const f = filterRef.current;
    // idle(검색어·필터 모두 없음)이면 서버 조회 불필요 — revalidatePath가 원본 목록을 갱신.
    if (f.trimmed.length === 0 && f.category === null) return;
    runFetch(f.trimmed, f.category);
  }

  function runFetch(q: string, cat: MemoCategory | null) {
    const seq = ++seqRef.current;
    setStatus("searching");
    searchMemosAction(q, cat).then(
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

  function resetToIdle() {
    seqRef.current++; // 진행 중 응답 무효화
    setResults(null);
    setStatus("done");
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    const next = value.trim();
    filterRef.current = { trimmed: next, category };
    if (next.length === 0) {
      // 카테고리 필터가 걸려 있으면 필터 목록으로 즉시 복귀, 아니면 원본 목록.
      if (category === null) resetToIdle();
      else runFetch("", category);
      return;
    }
    timerRef.current = setTimeout(() => runFetch(next, category), DEBOUNCE_MS);
  }

  function handleCategoryChange(next: MemoCategory | null) {
    setCategory(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    filterRef.current = { trimmed, category: next };
    if (next === null && !active) {
      resetToIdle();
      return;
    }
    runFetch(trimmed, next);
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
  // searching이 최우선 분기 — 재조회 중 직전 결과의 카운트·빈 문구를 알리면 오보가 된다.
  // 필터 전용 모드(검색어 없음)의 결과 목록에는 카운트 라인을 붙이지 않는다 (null → sr-only 유지).
  const statusText =
    status === "failed"
      ? "검색에 실패했습니다 — 다시 시도해 주세요."
      : status === "searching" || results === null
        ? "검색 중…"
        : results.memos.length === 0
          ? active
            ? category !== null
              ? `‘${labelOf(category)}’ 카테고리에 일치하는 결과가 없습니다.`
              : `‘${trimmed}’에 대한 결과가 없습니다.`
            : `‘${category === null ? "" : labelOf(category)}’ 카테고리의 메모가 없습니다.`
          : active
            ? `${results.memos.length}개 결과${results.truncated ? ` · 최근 ${SEARCH_MEMOS_LIMIT}개만 표시` : ""}`
            : null;
  const isMessage = status === "failed" || results === null || !hasResults;

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
          {fetchMode && status === "searching" && (
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

      <div role="group" aria-label="카테고리 필터" className="flex flex-wrap gap-1.5">
        <button
          type="button"
          aria-pressed={category === null}
          onClick={() => handleCategoryChange(null)}
          className={
            category === null
              ? "rounded-full bg-neutral-900 px-2.5 py-0.5 text-xs text-white"
              : "rounded-full border border-neutral-200 px-2.5 py-0.5 text-xs text-neutral-500 hover:text-neutral-900"
          }
        >
          전체
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={category === c.id}
            onClick={() => handleCategoryChange(category === c.id ? null : c.id)}
            className={
              category === c.id
                ? "rounded-full bg-neutral-900 px-2.5 py-0.5 text-xs text-white"
                : "rounded-full border border-neutral-200 px-2.5 py-0.5 text-xs text-neutral-500 hover:text-neutral-900"
            }
          >
            {c.labelKo}
          </button>
        ))}
      </div>

      {fetchMode ? (
        <>
          {/* live 영역은 fetchMode 동안 상시 mount — 사라지면 SR가 후속 상태 변화를 놓친다. */}
          <p
            aria-live="polite"
            className={
              statusText === null
                ? "sr-only"
                : isMessage
                  ? "py-8 text-center text-sm text-neutral-400"
                  : "text-xs text-neutral-400"
            }
          >
            {statusText ?? ""}
          </p>
          {status !== "failed" && results !== null && results.memos.length > 0 && (
            <MemoList
              memos={results.memos}
              transformationsByMemo={transformationsByMemo}
              presets={presets}
              actionItemsByMemo={actionItemsByMemo}
              highlightTerms={highlightTerms}
              onMutated={refreshCurrent}
              categories={categories}
            />
          )}
        </>
      ) : (
        <MemoList
          memos={memos}
          transformationsByMemo={transformationsByMemo}
          presets={presets}
          actionItemsByMemo={actionItemsByMemo}
          categories={categories}
        />
      )}
    </div>
  );
}
